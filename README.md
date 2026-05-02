# 编程随想博文与本人评论搜索

一个纯静态的全文搜索工具，用来检索“编程随想”博客的全部博文，以及评论区中“编程随想”本人的回复。

在线访问：

<https://programthink-search.bianchengsuixiang89.workers.dev/>

备用跳转地址：

<https://bianchengsuixiang89.github.io/programthink_search/>

GitHub Pages 地址只用于跳转到 Cloudflare Workers 站点，主要访问流量由 Cloudflare 承担。

## 为什么做

编程随想博客内容很多，评论区里也有大量博主本人对读者问题的补充说明。很多旧文、旧评论、概念解释、资料链接散落在不同年份的页面里，靠普通浏览很难找。

这个工具的目标很简单：让读者能快速搜索原始资料，并跳回对应原文或评论位置。

## 数据来源

数据来自 `cirubla.github.io` 镜像备份。

感谢该镜像作者制作并维护编程随想博客备份，让这些资料可以继续被访问、检索和引用。

## 部署说明

当前主站部署在 Cloudflare Workers Static Assets。
