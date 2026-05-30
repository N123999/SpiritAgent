import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  isSubagentStatusSurfaceText,
  parsePendingSubagentStatusText,
} from '../../dist-electron/src/lib/subagent-display.js';

test('isSubagentStatusSurfaceText detects runtime status lines', () => {
  assert.equal(
    isSubagentStatusSurfaceText('输出 "Spirit 牛逼" 这句话，不要做任何其他事情。: 运行中'),
    true,
  );
  assert.equal(
    isSubagentStatusSurfaceText('请输出"Spirit 牛逼"这句话。: The'),
    true,
  );
  assert.equal(
    isSubagentStatusSurfaceText('请输出"Spirit 牛逼"这句话。: Sp'),
    true,
  );
  assert.equal(
    isSubagentStatusSurfaceText(
      '输出 "Spirit 牛逼" 这句话。: The user wants me to output "Spirit 牛逼" — that\'s all.',
    ),
    true,
  );
  assert.equal(isSubagentStatusSurfaceText('Spirit 牛逼'), false);
  assert.equal(
    isSubagentStatusSurfaceText('子智能体已完成，输出如下：**Spirit 牛逼**'),
    false,
  );
  assert.equal(
    isSubagentStatusSurfaceText('子智能体已完成，输出如下：\n\n**Spirit 牛逼**'),
    false,
  );
  assert.equal(
    isSubagentStatusSurfaceText('好的，又来一遍 :) 有什么需要我接着搞的？'),
    false,
  );
});

test('isSubagentStatusSurfaceText rejects assistant prose with colons', () => {
  assert.equal(isSubagentStatusSurfaceText('你是想让我：删除目录'), false);
  assert.equal(
    isSubagentStatusSurfaceText(
      '「非更改区」我不确定你指的是什么。你是想让我：\n* 删除未跟踪目录？\n* 还是回退提交？',
    ),
    false,
  );
  assert.equal(
    isSubagentStatusSurfaceText(
      '在 VS Code 源代码管理面板里，通常分为「暂存的更改」「更改」和「未跟踪的文件」。你是想让我：',
    ),
    false,
  );
});

test('parsePendingSubagentStatusText only accepts subagent runtime status', () => {
  assert.equal(parsePendingSubagentStatusText('| Review auth: 运行中'), 'Review auth: 运行中');
  assert.equal(parsePendingSubagentStatusText('/ Thinking...'), undefined);
  assert.equal(
    parsePendingSubagentStatusText('| 用户想回退：删除未跟踪文件'),
    undefined,
  );
});
