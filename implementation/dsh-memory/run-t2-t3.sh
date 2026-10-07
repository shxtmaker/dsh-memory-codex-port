#!/usr/bin/env bash
# T2/T3 真实验收入口：凭据只从环境变量读取，不写入任何文件。
#
# 用法：
#   export WEKNORA_READ_KEY='<读取凭据>'
#   export WEKNORA_PUBLISH_KEY='<发布凭据>'   # 可省略，缺省回退到读取凭据
#   export WEKNORA_TENANT_ID='<租户ID>'        # 租户 key 可省略
#   export WEKNORA_QUERY='<库内已知答案的查询>'
#   export WEKNORA_EXPECT='<期望出现在命中正文中的字符串>'
#   ./run-t2-t3.sh
set -euo pipefail
cd "$(dirname "$0")"

: "${WEKNORA_BASE_URL:=http://192.168.3.100:18080/api/v1}"
: "${WEKNORA_KB_ID:=4f4ff687-7b56-4f6c-ad83-fd5aaa627731}"
: "${WEKNORA_PUBLISH_KB_ID:=$WEKNORA_KB_ID}"
export WEKNORA_BASE_URL WEKNORA_KB_ID WEKNORA_PUBLISH_KB_ID

for name in WEKNORA_READ_KEY WEKNORA_QUERY; do
  if [ -z "${!name:-}" ]; then
    echo "缺少 $name：真实检索不可用即视为未通过，不以跳过代替。" >&2
    exit 2
  fi
done

echo "环境：$WEKNORA_BASE_URL · 知识库 $WEKNORA_KB_ID"
echo "凭据：读取=$([ -n "${WEKNORA_READ_KEY:-}" ] && echo 已设置 || echo 未设置) 发布=$([ -n "${WEKNORA_PUBLISH_KEY:-}" ] && echo 已设置 || echo 回退读取)"
echo
npm run --silent build >/dev/null
node tests/weknora-real.mjs
