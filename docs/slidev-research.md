# Slidev 調査レポート

## 目次
1. [Slidevとは何か](#1-slidevとは何か)
2. [Markdownファイルの形式・構文](#2-markdownファイルの形式構文)
3. [スライドの区切り方](#3-スライドの区切り方)
4. [フロントマターの設定項目](#4-フロントマターの設定項目)
5. [コードブロック、画像、レイアウトの書き方](#5-コードブロック画像レイアウトの書き方)

---

## 1. Slidevとは何か

### 概要

**Slidev** (slide + dev, /slaɪdɪv/) は、開発者向けに設計されたWebベースのスライド作成・プレゼンテーションツールです。Markdownでコンテンツを記述することに集中でき、Web技術の力を活用してピクセルパーフェクトなデザインとインタラクティブなデモをプレゼンテーションに組み込むことができます。

### 主要技術スタック

| 技術 | 用途 |
|------|------|
| **Vite** | 超高速フロントエンドツーリング |
| **Vue 3** | Markdownの拡張とインタラクティブコンポーネント |
| **UnoCSS** | オンデマンドのユーティリティファーストCSS |
| **Shiki** | シンタックスハイライト |
| **Monaco Editor** | ライブコーディング機能 |
| **KaTeX** | LaTeX数式レンダリング |
| **Mermaid / PlantUML** | テキストベースの図表作成 |

### 主な機能

- **Markdownベースのコンテンツ作成**: シンプルな記法でスライドを作成
- **コードハイライト**: Shikiによる高品質なシンタックスハイライト
- **ライブコーディング**: Monaco Editorによるリアルタイムコード編集
- **図表サポート**: Mermaid、PlantUMLによるダイアグラム
- **数式レンダリング**: KaTeXによるLaTeX数式
- **録画機能**: プレゼンテーションの録画・カメラビュー
- **描画・注釈ツール**: 手書き注釈機能
- **PDF/PPTX/PNGエクスポート**: 様々な形式での出力

### インストール方法

Node.js 18.0以上が必要です。

```bash
# pnpm
pnpm create slidev

# npm
npm init slidev

# yarn
yarn create slidev

# bun
bun create slidev
```

### 基本コマンド

```bash
slidev              # 開発サーバーを起動
slidev export       # PDF、PPTX、PNGにエクスポート
slidev build        # 静的Webアプリケーションをビルド
slidev format       # スライドをフォーマット
```

---

## 2. Markdownファイルの形式・構文

### 基本構造

Slidevのプレゼンテーションは `slides.md` ファイルを中心に構成されます。通常のMarkdown記法に加えて、Slidev独自の拡張機能が利用できます。

### サポートされる機能

#### 標準Markdown

- 見出し (`#`, `##`, `###`)
- リスト（箇条書き・番号付き）
- 強調 (`**太字**`, `*斜体*`)
- リンク・画像
- コードブロック
- テーブル

#### Slidev拡張機能

- **LaTeX数式**: インライン `$E = mc^2$` またはブロック
- **ノート**: HTMLコメントでプレゼンターノートを追加
- **MDC構文**: Markdownコンポーネント構文
- **Vueコンポーネント**: Vueコンポーネントの直接使用
- **スコープ付きCSS**: スライド固有のスタイル

---

## 3. スライドの区切り方

### 基本構文

スライドは `---` (3つのハイフン) で区切ります。**前後に空行が必要**です。

```markdown
# スライド1

ここにコンテンツを記述

---

# スライド2

次のスライドのコンテンツ

---

# スライド3

さらに次のスライド
```

### フロントマター付きの区切り

フロントマターを含む場合:

```markdown
---
layout: cover
---

# タイトルスライド

---
layout: center
background: /images/background.png
---

# 中央揃えスライド

---

# 通常のスライド
```

### ノート（プレゼンターノート）

スライドの最後にHTMLコメントを追加することで、プレゼンターノートを記述できます:

```markdown
# スライドタイトル

スライドの内容

<!--
これはプレゼンターノートです。
**Markdown**も使えます。
-->
```

---

## 4. フロントマターの設定項目

### ヘッドマター（グローバル設定）

最初のスライドのフロントマターは「ヘッドマター」と呼ばれ、プレゼンテーション全体の設定を行います。

```yaml
---
theme: seriph
title: プレゼンテーションタイトル
titleTemplate: '%s - Slidev'
author: 著者名
keywords: キーワード1,キーワード2
info: |
  ## スライドの説明
  Markdownで記述可能
presenter: true
download: true
exportFilename: my-presentation
colorSchema: auto
aspectRatio: 16/9
canvasWidth: 980
fonts:
  sans: Robot
  serif: Robot Slab
  mono: Fira Code
drawings:
  enabled: true
  persist: false
  presenterOnly: false
  syncAll: true
htmlAttrs:
  dir: ltr
  lang: ja
---
```

### 主なヘッドマター設定項目

| 項目 | 説明 | デフォルト |
|------|------|-----------|
| `theme` | テーマID、パッケージ名、またはローカルパス | `default` |
| `title` | プレゼンテーションタイトル | 最初の見出しから推測 |
| `titleTemplate` | Webページタイトルのテンプレート | `'%s - Slidev'` |
| `author` | 著者（PDF/PPTXエクスポート用） | - |
| `keywords` | キーワード（カンマ区切り） | - |
| `info` | スライド情報（Markdown可） | `false` |
| `presenter` | プレゼンターモードの有効化 | - |
| `download` | SPAビルドでのPDFダウンロード有効化 | `false` |
| `exportFilename` | エクスポートファイル名 | - |
| `colorSchema` | カラースキーマ (`auto`/`light`/`dark`) | `auto` |
| `aspectRatio` | スライドのアスペクト比 | `16/9` |
| `canvasWidth` | キャンバス幅 | `980` |
| `fonts` | フォント設定 | - |

### スライド個別のフロントマター

各スライドで使用できる設定:

```yaml
---
layout: center
background: /images/bg.png
class: text-white
transition: slide-left
clicks: 3
clicksStart: 0
disabled: false
hide: false
hideInToc: false
level: 2
preload: true
routeAlias: my-slide
src: ./external-slide.md
title: カスタムタイトル
zoom: 0.8
dragPos:
  element-id: '100,200,300,400'
---
```

### 主なスライド設定項目

| 項目 | 説明 | デフォルト |
|------|------|-----------|
| `layout` | レイアウトコンポーネント | 最初は`cover`、他は`default` |
| `background` | 背景画像のパス | - |
| `class` | CSSクラス | - |
| `transition` | 次のスライドへのトランジション | - |
| `clicks` | カスタムクリック数 | `0` |
| `clicksStart` | 開始クリック数 | - |
| `disabled` | スライドを完全に無効化・非表示 | `false` |
| `hide` | `disabled`と同じ | `false` |
| `hideInToc` | 目次から非表示 | `false` |
| `level` | タイトルレベルのオーバーライド | - |
| `preload` | 事前にマウント | `true` |
| `routeAlias` | URLのルートエイリアス | - |
| `src` | 外部Markdownファイルのインクルード | - |
| `title` | カスタムタイトル | - |
| `zoom` | ズームスケール | - |

### トランジション設定

組み込みトランジション:
- `fade` - フェード
- `fade-out` - フェードアウト
- `slide-up` - 上方向スライド
- `slide-down` - 下方向スライド
- `slide-left` - 左方向スライド
- `slide-right` - 右方向スライド
- `view-transition` - ビュートランジション

---

## 5. コードブロック、画像、レイアウトの書き方

### コードブロック

#### 基本構文

````markdown
```typescript
function hello(name: string): string {
  return `Hello, ${name}!`
}
```
````

#### 行番号の表示

言語指定の後に `{行番号を表示}` を追加:

````markdown
```ts {1}
// 行番号が表示されます
const x = 1
```
````

#### 行ハイライト（静的）

特定の行をハイライト:

````markdown
```ts {2,3}
function add(
  a: Ref<number> | number,  // この行がハイライト
  b: Ref<number> | number   // この行もハイライト
) {
  return computed(() => unref(a) + unref(b))
}
```
````

**構文オプション:**
- `{2}` - 2行目をハイライト
- `{2,3}` - 2行目と3行目をハイライト
- `{2-5}` - 2〜5行目をハイライト
- `{2,4-6,8}` - 複合指定

#### 行ハイライト（クリックアニメーション）

パイプ `|` で区切ることで、クリックごとにハイライトを変更:

````markdown
```ts {2-3|5|all}
function add(
  a: Ref<number> | number,
  b: Ref<number> | number
) {
  return computed(() => unref(a) + unref(b))
}
```
````

**動作:**
1. 最初: 2-3行目がハイライト
2. 1回目クリック: 5行目がハイライト
3. 2回目クリック: 全体がハイライト

#### 特殊オプション

- `{hide}` - コードブロックを初期非表示
- `{none}` - ハイライトを無効化
- `{all}` - 全体をハイライト

#### Monaco Editor（ライブコーディング）

言語指定に `{monaco}` を追加:

````markdown
```ts {monaco}
// 編集可能なコードエディター
const count = ref(0)
```
````

### 画像の挿入

#### 標準Markdown

```markdown
![代替テキスト](/images/photo.png)
```

#### 背景画像

フロントマターで設定:

```yaml
---
background: /images/background.jpg
---
```

#### 画像レイアウト

画像専用レイアウトを使用:

```yaml
---
layout: image
image: /images/fullscreen.jpg
---
```

### 組み込みレイアウト

#### 基本レイアウト

| レイアウト | 説明 |
|-----------|------|
| `default` | 最も基本的なレイアウト |
| `center` | コンテンツを中央に配置 |
| `cover` | カバーページ用 |
| `intro` | タイトル、説明、著者を表示 |
| `section` | 新しいセクションの開始 |
| `statement` | 主張・声明を強調 |
| `quote` | 引用を目立たせる |
| `fact` | データや事実を強調 |
| `full` | 画面全体を使用 |
| `end` | 最終スライド用 |
| `none` | スタイルなし |

#### 画像レイアウト

```yaml
---
layout: image-right
image: /images/photo.jpg
---

# タイトル

左側にコンテンツ、右側に画像
```

```yaml
---
layout: image-left
image: /images/photo.jpg
class: my-content-class
backgroundSize: contain
---

# タイトル

右側にコンテンツ、左側に画像
```

```yaml
---
layout: image
image: /images/fullscreen.jpg
---
```

#### iframeレイアウト

```yaml
---
layout: iframe-right
url: https://example.com
---

# Webページの埋め込み
```

#### 2カラムレイアウト

```yaml
---
layout: two-cols
---

# 左側

左側のコンテンツ

::right::

# 右側

右側のコンテンツ
```

```yaml
---
layout: two-cols-header
---

# ヘッダー（全幅）

::left::

左側のコンテンツ

::right::

右側のコンテンツ
```

### 完全な例

```markdown
---
theme: seriph
title: Slidevデモ
author: 開発者
transition: slide-left
---

# Slidevへようこそ

開発者のためのプレゼンテーション

---
layout: center
class: text-center
---

# 中央揃えのスライド

重要なメッセージを表示

---
layout: two-cols
---

# コードの例

::right::

```ts {2-3|5|all}
function greet(name: string) {
  const message = `Hello, ${name}!`
  console.log(message)

  return message
}
```

---
layout: image-right
image: /images/demo.png
---

# 画像付きスライド

- ポイント1
- ポイント2
- ポイント3

---
layout: end
---

# ありがとうございました

<!-- プレゼンターノート: ここで質疑応答 -->
```

---

## 参考資料

- [Slidev 公式サイト](https://sli.dev/)
- [Slidev Getting Started](https://sli.dev/guide/)
- [Slidev Syntax Guide](https://sli.dev/guide/syntax)
- [Slidev Built-in Layouts](https://sli.dev/builtin/layouts)
- [Slidev Features](https://sli.dev/features/)
- [Slidev Customizations](https://sli.dev/custom/)
- [Slidev GitHub Repository](https://github.com/slidevjs/slidev)
