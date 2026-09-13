module.exports = {
  branches: ['main'],
  plugins: [
    '@semantic-release/commit-analyzer',
    '@semantic-release/release-notes-generator',
    [
      '@semantic-release/changelog',
      { changelogFile: 'CHANGELOG.md' },
    ],
    '@semantic-release/npm',
    [
      '@semantic-release/github',
      {
        // 关掉所有会自动评论 issue/PR 的行为。
        //
        // 原因：CHANGELOG 里的 "closes [#117]" / "(#99)" 这类引用是**上游
        // dsh-pocket 仓库的 issue 编号**（本仓库从上游 fork 而来，历史提交
        // 原样保留）。semantic-release 在 success 步骤会挨个给这些编号发评论，
        // 但它们在 kinderao/dsh-pocket-relay 里并不存在，于是抛
        // NOT_FOUND: Could not resolve to an issue or pull request => 整个
        // release job 标记为 failure => 下游 relay-binaries（needs: release）
        // 被 skip => v1.0.0 的 GitHub Release 一个二进制资产都没有。
        //
        // 注意：这一步发生在 npm 发布**之后**，所以包本身已经发出去了；
        // 但它会连带砍掉二进制产物，因此必须关掉。
        successComment: false,
        failComment: false,
        failTitle: false,
        labels: false,
      },
    ],
    [
      '@semantic-release/git',
      { assets: ['CHANGELOG.md', 'package.json', 'package-lock.json'] },
    ],
  ],
}
