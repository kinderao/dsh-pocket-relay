// Package logx 是一个够用就好的日志器：
//   - 输出到 stdout（nohup 重定向到文件即可），带时间戳与级别；
//   - 在内存里保留最近若干行，供 Web 管理端展示 —— 排查「刚才连不上」时，
//     让用户不必 ssh 上去翻日志是管理端最实际的价值之一。
package logx

import (
	"fmt"
	"os"
	"sync"
	"time"
)

// DefaultRingSize 环形缓冲保留的行数。
const DefaultRingSize = 500

// Logger 同时满足 hub.Logger 与 certs.Logger 的接口。
type Logger struct {
	mu   sync.Mutex
	ring []string
	size int
	out  *os.File
}

// New 创建日志器。
func New(ringSize int) *Logger {
	if ringSize <= 0 {
		ringSize = DefaultRingSize
	}
	return &Logger{size: ringSize, out: os.Stdout}
}

func (l *Logger) write(level, format string, args ...any) {
	msg := fmt.Sprintf(format, args...)
	line := fmt.Sprintf("%s [%s] %s", time.Now().Format("2006-01-02 15:04:05"), level, msg)

	l.mu.Lock()
	defer l.mu.Unlock()
	fmt.Fprintln(l.out, line)
	l.ring = append(l.ring, line)
	if len(l.ring) > l.size {
		l.ring = l.ring[len(l.ring)-l.size:]
	}
}

// Infof 一般信息。
func (l *Logger) Infof(format string, args ...any) { l.write("INFO", format, args...) }

// Warnf 警告/错误（不区分级别：relay 里能出问题的地方都值得看）。
func (l *Logger) Warnf(format string, args ...any) { l.write("WARN", format, args...) }

// Tail 返回最近 n 行日志（管理端用）。
func (l *Logger) Tail(n int) []string {
	l.mu.Lock()
	defer l.mu.Unlock()
	if n <= 0 || n > len(l.ring) {
		n = len(l.ring)
	}
	out := make([]string, n)
	copy(out, l.ring[len(l.ring)-n:])
	return out
}
