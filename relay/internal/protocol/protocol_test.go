package protocol

import (
	"bytes"
	"testing"
)

// 线协议最容易写错的一处，也是本次 Go 重写真正踩到的坑：
// 握手行与裸流在同一个 TCP 分片里到达时，裸流里**必然含 '\n'**（HTTP 就是一堆 CRLF）。
// 如果用「切出所有行再 TakeRest」，TakeRest 返回的是最后一个 '\n' 之后的内容，
// 中间那些「行」会被当帧丢掉 → 随机丢请求头/丢正文，且只在特定分包下复现。
func TestTakeLineStopsAtFirstNewline(t *testing.T) {
	sp := NewLineSplitter(0)

	body := "GET / HTTP/1.1\r\nHost: x\r\n\r\n"
	chunk := append(EncodeControl(map[string]any{"t": TData, "id": "abc"}), []byte(body)...)
	if err := sp.Push(chunk); err != nil {
		t.Fatal(err)
	}

	line, ok := sp.TakeLine()
	if !ok {
		t.Fatal("应当能取到握手行")
	}
	if got := FrameString(ParseControl(line), "t"); got != TData {
		t.Fatalf("首行帧类型应为 data，实际 %q", got)
	}

	rest := sp.TakeRest()
	if string(rest) != body {
		t.Fatalf("握手行之后的裸流丢了：\n期望 %q\n实际 %q", body, string(rest))
	}
	if sp.Buffered() != 0 {
		t.Fatalf("TakeRest 之后缓冲应当清空，实际 %d", sp.Buffered())
	}
}

// 纯 NDJSON（控制连接）要把所有整行都取出来。
func TestTakeLineLoopsForControlFrames(t *testing.T) {
	sp := NewLineSplitter(0)
	chunk := append(EncodeControl(map[string]any{"t": TPing, "at": 1}), EncodeControl(map[string]any{"t": TPong, "at": 1})...)
	if err := sp.Push(chunk); err != nil {
		t.Fatal(err)
	}
	var kinds []string
	for {
		line, ok := sp.TakeLine()
		if !ok {
			break
		}
		kinds = append(kinds, FrameString(ParseControl(line), "t"))
	}
	if len(kinds) != 2 || kinds[0] != TPing || kinds[1] != TPong {
		t.Fatalf("应当依次取到 ping/pong，实际 %v", kinds)
	}
	if _, ok := sp.TakeLine(); ok {
		t.Fatal("取完后不该还有行")
	}
}

// 分片到达：行被切成几段也要能拼回来。
func TestSplitterAcrossChunks(t *testing.T) {
	sp := NewLineSplitter(0)
	full := EncodeControl(map[string]any{"t": THello, "agent": "default"})

	if err := sp.Push(full[:5]); err != nil {
		t.Fatal(err)
	}
	if _, ok := sp.TakeLine(); ok {
		t.Fatal("半个行不该取到内容")
	}
	if err := sp.Push(full[5:]); err != nil {
		t.Fatal(err)
	}
	line, ok := sp.TakeLine()
	if !ok {
		t.Fatal("补齐后应当能取到行")
	}
	frame := ParseControl(line)
	if FrameString(frame, "t") != THello || FrameString(frame, "agent") != "default" {
		t.Fatalf("拼回来的帧不对：%v", frame)
	}
}

// 超长行必须报错而不是无限吞内存；但**已成行之后的裸流再长也不该报错**
// （否则传个大文件必然失败）。
func TestSplitterLineLimitOnlyAppliesToIncompleteLine(t *testing.T) {
	sp := NewLineSplitter(64)
	if err := sp.Push(bytes.Repeat([]byte("x"), 128)); err == nil {
		t.Fatal("未成行的超长内容应当报错")
	}

	sp2 := NewLineSplitter(64)
	big := append(EncodeControl(map[string]any{"t": TData}), bytes.Repeat([]byte("y"), 4096)...)
	if err := sp2.Push(big); err != nil {
		t.Fatalf("已成行之后的大块裸流不该报错：%v", err)
	}
	if _, ok := sp2.TakeLine(); !ok {
		t.Fatal("应当能取到握手行")
	}
	if len(sp2.TakeRest()) != 4096 {
		t.Fatal("裸流长度不对")
	}
}

// 空 token 一律判否：没配 token 时绝不能变成「人人可过」。
func TestTokenEquals(t *testing.T) {
	cases := []struct {
		a, b string
		want bool
	}{
		{"abcdef", "abcdef", true},
		{"abcdef", "abcdeg", false},
		{"abcdef", "abcde", false},
		{"", "", false},
		{"abc", "", false},
		{"", "abc", false},
	}
	for _, c := range cases {
		if got := TokenEquals(c.a, c.b); got != c.want {
			t.Errorf("TokenEquals(%q,%q) = %v，期望 %v", c.a, c.b, got, c.want)
		}
	}
}

func TestParseControlRejectsGarbage(t *testing.T) {
	for _, s := range []string{"", "not json", "[1,2,3]", "null"} {
		if got := ParseControl([]byte(s)); got != nil {
			// "[1,2,3]" 与 "null" 解到非对象，应当被判非法
			if _, isMap := any(got).(map[string]any); isMap {
				t.Errorf("%q 不该被解析成控制帧", s)
			}
		}
	}
}
