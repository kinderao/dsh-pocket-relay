// 腾讯云 DNSPod 的 DNS-01 提供方（单独一个文件，便于以后加别的服务商）。
//
// DNS-01 是本项目唯一可接受的 ACME 挑战方式：HTTP-01 要占 80、TLS-ALPN-01 要占 443，
// 而用户明确要求要么不用 443、要么服务器上只开自己的业务端口 —— 只有 DNS-01
// 一个入站端口都不需要。
package certs

import (
	"fmt"

	"github.com/go-acme/lego/v4/challenge"
	"github.com/go-acme/lego/v4/providers/dns/tencentcloud"

	"github.com/kinderao/dsh-pocket-relay/relay/internal/config"
)

// newTencentProvider 组装腾讯云 DNS 提供方。
func newTencentProvider(cfg config.ACMEConfig) (challenge.Provider, error) {
	if cfg.SecretID == "" || cfg.SecretKey == "" {
		return nil, fmt.Errorf("腾讯云 DNS-01 需要 secretId 与 secretKey")
	}
	tc := tencentcloud.NewDefaultConfig()
	tc.SecretID = cfg.SecretID
	tc.SecretKey = cfg.SecretKey
	if cfg.Region != "" {
		tc.Region = cfg.Region
	}
	provider, err := tencentcloud.NewDNSProviderConfig(tc)
	if err != nil {
		return nil, fmt.Errorf("初始化腾讯云 DNS 提供方失败：%w", err)
	}
	return provider, nil
}
