/**
 * 跨段落划线处理器
 * 处理跨段落选区的划线渲染
 */

export class CrossParagraphHighlighter {
  /**
   * 检测 Range 是否跨段落
   */
  static isCrossParagraph(range: Range, container: HTMLElement): boolean {
    if (!range || range.collapsed) return false;

    const startContainer = range.startContainer;
    const endContainer = range.endContainer;

    // 如果开始和结束容器不同，可能跨段落
    if (startContainer !== endContainer) {
      // 检查是否跨越了块级元素（如 p, div, h1-h6 等）
      const blockElements = [
        "P",
        "DIV",
        "H1",
        "H2",
        "H3",
        "H4",
        "H5",
        "H6",
        "LI",
        "BLOCKQUOTE",
      ];

      let startBlock: Element | null = null;
      let endBlock: Element | null = null;

      // 查找开始和结束的块级元素
      const boundary = container || document.body;

      let node: Node | null = startContainer;
      while (node && node !== boundary && node !== document.body) {
        if (node.nodeType === Node.ELEMENT_NODE) {
          const el = node as Element;
          if (blockElements.includes(el.tagName)) {
            startBlock = el;
            break;
          }
        }
        node = node.parentNode;
      }

      node = endContainer;
      while (node && node !== boundary && node !== document.body) {
        if (node.nodeType === Node.ELEMENT_NODE) {
          const el = node as Element;
          if (blockElements.includes(el.tagName)) {
            endBlock = el;
            break;
          }
        }
        node = node.parentNode;
      }

      // 如果开始和结束的块级元素不同，则跨段落
      return (
        startBlock !== null && endBlock !== null && startBlock !== endBlock
      );
    }

    return false;
  }

  /**
   * 包装跨段落的 Range
   */
  static wrapCrossParagraphRange(
    range: Range,
    highlightId: string,
    color: string
  ): HTMLSpanElement[] {
    if (!this.isCrossParagraph(range, document.body)) {
      // 单段落，使用标准方法
      return this.wrapSingleParagraphRange(range, highlightId, color);
    }

    return this.wrapMultipleParagraphRange(range, highlightId, color);
  }

  /**
   * 包装单段落 Range
   */
  private static wrapSingleParagraphRange(
    range: Range,
    highlightId: string,
    color: string
  ): HTMLSpanElement[] {
    const wrapper = document.createElement("span");
    wrapper.className = "epub-highlight underline";
    wrapper.dataset.highlightId = highlightId;
    wrapper.style.textDecoration = "underline";
    wrapper.style.textDecorationColor = color;
    wrapper.style.textDecorationThickness = "2px";
    wrapper.style.textUnderlineOffset = "3px";
    wrapper.style.cursor = "pointer";
    wrapper.style.pointerEvents = "auto";

    try {
      range.surroundContents(wrapper);
      return [wrapper];
    } catch (e) {
      // 使用 fallback 方法
      const contents = range.cloneContents();
      wrapper.appendChild(contents);
      range.deleteContents();
      range.insertNode(wrapper);
      return [wrapper];
    }
  }

  /**
   * 包装多段落 Range
   */
  private static wrapMultipleParagraphRange(
    range: Range,
    highlightId: string,
    color: string
  ): HTMLSpanElement[] {
    const wrappers: HTMLSpanElement[] = [];
    const doc = range.startContainer.ownerDocument || document;

    // 获取所有文本节点
    const walker = doc.createTreeWalker(
      range.commonAncestorContainer,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: (node) => {
          const range = document.createRange();
          range.selectNodeContents(node);
          return range.intersectsNode(node)
            ? NodeFilter.FILTER_ACCEPT
            : NodeFilter.FILTER_REJECT;
        },
      }
    );

    let node: Node | null;
    while ((node = walker.nextNode())) {
      const textNode = node as Text;
      const textRange = doc.createRange();
      textRange.selectNodeContents(textNode);

      // 检查这个文本节点是否在选择范围内
      if (
        range.compareBoundaryPoints(Range.START_TO_START, textRange) <= 0 &&
        range.compareBoundaryPoints(Range.END_TO_END, textRange) >= 0
      ) {
        // 完全包含
        textRange.selectNodeContents(textNode);
      } else if (
        range.compareBoundaryPoints(Range.START_TO_START, textRange) <= 0 &&
        range.compareBoundaryPoints(Range.END_TO_START, textRange) > 0
      ) {
        // 部分包含（开始部分）
        textRange.setStart(textNode, 0);
        textRange.setEnd(textNode, Math.min(textNode.length, range.endOffset));
      } else if (
        range.compareBoundaryPoints(Range.START_TO_END, textRange) < 0 &&
        range.compareBoundaryPoints(Range.END_TO_END, textRange) >= 0
      ) {
        // 部分包含（结束部分）
        textRange.setStart(textNode, Math.max(0, range.startOffset));
        textRange.setEnd(textNode, textNode.length);
      } else {
        continue;
      }

      const wrapper = doc.createElement("span");
      wrapper.className = "epub-highlight underline";
      wrapper.dataset.highlightId = highlightId;
      wrapper.style.textDecoration = "underline";
      wrapper.style.textDecorationColor = color;
      wrapper.style.textDecorationThickness = "2px";
      wrapper.style.textUnderlineOffset = "3px";
      wrapper.style.cursor = "pointer";
      wrapper.style.pointerEvents = "auto";

      try {
        textRange.surroundContents(wrapper);
        wrappers.push(wrapper);
      } catch (e) {
        const contents = textRange.cloneContents();
        wrapper.appendChild(contents);
        textRange.deleteContents();
        textRange.insertNode(wrapper);
        wrappers.push(wrapper);
      }
    }

    return wrappers;
  }
}
