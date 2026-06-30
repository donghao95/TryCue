# 安全策略

## 报告漏洞

TryCue 重视安全。如果你发现安全漏洞，请按以下流程报告，**不要开公开 GitHub Issue**。

1. 通过 GitHub Security 的私有漏洞报告功能提交：
   - 仓库主页 → Security → Report a vulnerability
   - 或直接访问：<https://github.com/donghao95/TryCue/security/advisories/new>
2. 在报告中说明：
   - 漏洞类型和影响范围
   - 复现步骤（最小可复现示例最佳）
   - 受影响的版本 / 分支 / commit
   - 你建议的修复方向（可选）

## 响应时间

- 收到报告后会在 **3 个工作日内**确认收到
- 初步评估会在 **7 个工作日内**给出
- 修复方案和时间表根据严重程度协商

## 披露政策

- 在修复发布前，请勿公开披露漏洞细节
- 修复发布后，我们会通过 GitHub Security Advisory 公开致谢（如果你同意）

## 支持版本

TryCue 处于 V1 阶段，安全修复只针对 `main` 分支最新版本，不维护旧版本的 backport。

## 范围

**属于本策略范围**：

- 服务端注入、越权、状态机绕过、幂等性破坏等应用层漏洞
- 通过 API 输入触发的崩溃或异常行为
- 密钥 / 凭证意外泄露到公开仓库

**不属于本策略范围**：

- mock 模式下的预期行为（mock 模式不连接真实 LLM）
- 需要真实 LLM API Key 才能触发、且不影响 mock 模式的问题（请直接开 Issue 讨论）
- 第三方依赖的已知漏洞（请通过 Dependabot PR 处理，除非有可利用的攻击路径）

## 密钥安全说明

TryCue 仓库设计上不包含真实 API Key：

- `.env.local` 和 `config/llm.local.yaml` 被 `.gitignore` 忽略，仅用于本地开发
- API Key 只在服务端使用，不会通过 GET settings API 回显，不会存入前端 localStorage
- 如果你发现仓库历史或源码中存在真实密钥泄露，请立即按上述流程报告。
