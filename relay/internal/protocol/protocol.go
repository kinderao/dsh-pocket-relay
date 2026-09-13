// Package protocol 实现 dsh-pocket-relay 的线协议（服务端侧的唯一实现）。
//
// 权威描述见仓库根目录 relay/PROTOCOL.md；PC 侧 Node agent 的对应实现是
// lib/relay-protocol.mjs。两边都改才算改了协议。
//
// 协议很薄，刻意如此：
//   - 控制连接：长连接，NDJSON（一行一条 JSON），承载 hello/welcome/open/close/ping/pong。
//   - 数据连接：每个访客 TCP 连接对应一条独立连接；首行 NDJSON 握手（data），
//     其后是纯裸字节，不再有任何封装。
//   - 访客侧：不上自定义协议，就是普通 HTTP/WebSocket —— relay 只搬字节。
package protocol

import (
	"bytes"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"fmt"
)

// Version 协议版本；两端不一致时 relay 直接拒绝，避免半懂不懂地跑。
const Version = 1

// 控制帧类型。
const (
	THello   = "hello"
	TWelcome = "welcome"
	TOpen    = "open"
	TClose   = "close"
	TData    = "data"
	TPing    = "ping"
	TPong    = "pong"
	TError   = "error"
)

// DefaultMaxLine 单行上限，防对端吐无限长行撑爆内存。
const DefaultMaxLine = 64 * 1024

// ErrLineTooLong 握手行超过上限。
var ErrLineTooLong = errors.New("relay: handshake line too long")

// EncodeControl 编码一条控制帧。
//
// 用 NDJSON 而不是二进制帧：隧道出问题时能在日志/抓包里直接看懂，
// 而这些帧的吞吐量相比承载的 HTTP 正文可以忽略。
func EncodeControl(v any) []byte {
	b, err := json.Marshal(v)
	if err != nil {
		// 调用方传的都是内部构造的小结构体，序列化失败属于编程错误
		b = []byte(`{"t":"error","error":"encode-failed"}`)
	}
	return append(b, '\n')
}

// ParseControl 解析一行控制 JSON；非法返回 nil。
func ParseControl(line []byte) map[string]any {
	var v map[string]any
	if err := json.Unmarshal(bytes.TrimRight(line, "\r"), &v); err != nil {
		return nil
	}
	return v
}

// FrameString 从解析后的帧里取字符串字段（缺失或类型不符返回空串）。
func FrameString(frame map[string]any, key string) string {
	if frame == nil {
		return ""
	}
	s, _ := frame[key].(string)
	return s
}

// LineSplitter 增量行切分器，用于「首行是 NDJSON 握手、其后是裸字节流」的协议。
//
// 用法（顺序很重要）：
//
//	sp.Push(chunk)
//	line, ok := sp.TakeLine()   // 只切到**第一个** '\n'
//	rest := sp.TakeRest()       // 握手行之后的全部字节 = 裸流开头
//
// **不能**用「切出所有行再 TakeRest」的写法：裸流里几乎必然含 '\n'
// （HTTP 请求就是一堆 CRLF），那样 TakeRest 返回的是最后一个 '\n' 之后的内容，
// 中间那些「行」会被当成帧丢掉 —— 表现为随机丢请求头，只在特定分包下复现。
// 这个坑是 protocol_test.go 里 TestTakeLineStopsAtFirstNewline 抓出来的。
type LineSplitter struct {
	pending []byte
	maxLine int
}

// NewLineSplitter 创建切分器；maxLine <= 0 时用 DefaultMaxLine。
func NewLineSplitter(maxLine int) *LineSplitter {
	if maxLine <= 0 {
		maxLine = DefaultMaxLine
	}
	return &LineSplitter{maxLine: maxLine}
}

// Push 追加数据。只做缓冲，不做切分。
//
// 上限只约束**尚未成行**的部分：一旦缓冲里出现 '\n'，后面的内容属于裸流，
// 再长也不该被判超限（否则传大文件必然失败）。
func (s *LineSplitter) Push(chunk []byte) error {
	if len(s.pending) == 0 {
		s.pending = chunk
	} else {
		s.pending = append(s.pending, chunk...)
	}
	if bytes.IndexByte(s.pending, '\n') < 0 && len(s.pending) > s.maxLine {
		return fmt.Errorf("%w (>%d bytes)", ErrLineTooLong, s.maxLine)
	}
	return nil
}

// TakeLine 取出第一行（不含 '\n'）。没有完整行时返回 ok=false 且不动缓冲。
func (s *LineSplitter) TakeLine() ([]byte, bool) {
	idx := bytes.IndexByte(s.pending, '\n')
	if idx < 0 {
		return nil, false
	}
	line := make([]byte, idx)
	copy(line, s.pending[:idx])
	s.pending = s.pending[idx+1:]
	return line, true
}

// TakeRest 取走剩余全部字节并清空缓冲（握手行之后就是裸流）。
func (s *LineSplitter) TakeRest() []byte {
	rest := s.pending
	s.pending = nil
	return rest
}

// Buffered 当前缓冲的字节数。
func (s *LineSplitter) Buffered() int { return len(s.pending) }

// TokenEquals 常量时间比较两个密钥。
//
// 用 == 比 token 会在首个不同字节处提前返回，理论上可被计时侧信道逐字节还原
// ——与 Node 侧 tokenEquals / lib/proxy.mjs 的 safeEqual 同一考量。
// 空值一律判否：没配 token 时不该变成「人人可过」。
func TokenEquals(a, b string) bool {
	if a == "" || b == "" || len(a) != len(b) {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(a), []byte(b)) == 1
}
