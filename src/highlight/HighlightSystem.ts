/**
 * 高精度划线定位系统
 * 实现多级回退定位算法（CFI+语义上下文+文本流偏移）
 */

export interface HighlightPosition {
  cfi: string; // Canonical Fragment Identifier
  textOffset: number; // 文本流偏移量
  semanticContext: string; // 语义上下文（前后文本）
  elementPath: string; // DOM 元素路径
  timestamp: number;
}

export interface Highlight {
  id: string;
  position: HighlightPosition;
  text: string;
  color: string;
  note?: string;
  createdAt: number;
  updatedAt: number;
}

export class HighlightSystem {
  private highlights: Map<string, Highlight> = new Map();
  private readonly CONTEXT_LENGTH = 50; // 上下文文本长度

  /**
   * 创建高精度定位信息
   */
  createPosition(
    selection: Selection,
    document: Document
  ): HighlightPosition | null {
    if (!selection.rangeCount) return null;

    const range = selection.getRangeAt(0);
    const cfi = this.generateCFI(range, document);
    const textOffset = this.calculateTextOffset(range, document);
    const semanticContext = this.extractSemanticContext(range);
    const elementPath = this.getElementPath(range.startContainer);

    return {
      cfi,
      textOffset,
      semanticContext,
      elementPath,
      timestamp: Date.now(),
    };
  }

  /**
   * 生成 CFI (Canonical Fragment Identifier)
   */
  private generateCFI(range: Range, document: Document): string {
    const startPath = this.getNodePath(range.startContainer, document);
    const endPath = this.getNodePath(range.endContainer, document);
    const startOffset = range.startOffset;
    const endOffset = range.endOffset;

    return `epubcfi(/6/${startPath}[${startOffset}],/6/${endPath}[${endOffset}])`;
  }

  /**
   * 获取节点路径
   */
  private getNodePath(node: Node, document: Document): string {
    const path: number[] = [];
    let current: Node | null = node;

    while (current && current !== document.body) {
      const parent = current.parentNode;
      if (!parent) break;

      let index = 0;
      let sibling = parent.firstChild;
      while (sibling && sibling !== current) {
        if (sibling.nodeType === Node.ELEMENT_NODE) {
          index++;
        }
        sibling = sibling.nextSibling;
      }

      path.unshift(index);
      current = parent;
    }

    return path.join("/");
  }

  /**
   * 计算文本流偏移量
   */
  private calculateTextOffset(range: Range, document: Document): number {
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
      null
    );

    let offset = 0;
    let node: Node | null;

    while ((node = walker.nextNode())) {
      if (node === range.startContainer) {
        offset += range.startOffset;
        break;
      }
      offset += node.textContent?.length || 0;
    }

    return offset;
  }

  /**
   * 提取语义上下文
   */
  private extractSemanticContext(range: Range): string {
    const text = range.toString();
    const startContainer = range.startContainer;
    const endContainer = range.endContainer;

    // 获取前文上下文
    let beforeText = "";
    if (startContainer.nodeType === Node.TEXT_NODE) {
      const textNode = startContainer as Text;
      const start = Math.max(0, range.startOffset - this.CONTEXT_LENGTH);
      beforeText =
        textNode.textContent?.substring(start, range.startOffset) || "";
    }

    // 获取后文上下文
    let afterText = "";
    if (endContainer.nodeType === Node.TEXT_NODE) {
      const textNode = endContainer as Text;
      const end = Math.min(
        textNode.textContent?.length || 0,
        range.endOffset + this.CONTEXT_LENGTH
      );
      afterText = textNode.textContent?.substring(range.endOffset, end) || "";
    }

    return `${beforeText}[${text}]${afterText}`;
  }

  /**
   * 获取元素路径
   */
  private getElementPath(node: Node): string {
    const path: string[] = [];
    let current: Node | null = node;

    // 如果是文本节点，获取其父元素
    if (current.nodeType === Node.TEXT_NODE) {
      current = current.parentElement;
    }

    while (current && current.nodeType === Node.ELEMENT_NODE) {
      const element = current as Element;
      let selector = element.tagName.toLowerCase();

      if (element.id) {
        selector += `#${element.id}`;
      } else if (element.className) {
        const classes = element.className.split(" ").filter(Boolean);
        if (classes.length > 0) {
          selector += `.${classes[0]}`;
        }
      }

      path.unshift(selector);
      current = element.parentElement;
    }

    return path.join(" > ");
  }

  /**
   * 从定位信息恢复选区
   */
  restoreRange(position: HighlightPosition, document: Document): Range | null {
    try {
      // 方法1: 使用 CFI 恢复
      const range = this.restoreFromCFI(position.cfi);
      if (range) return range;

      // 方法2: 使用语义上下文恢复
      const range2 = this.restoreFromContext(
        position.semanticContext,
        document
      );
      if (range2) return range2;

      // 方法3: 使用文本偏移恢复
      const range3 = this.restoreFromOffset(position.textOffset, document);
      if (range3) return range3;

      return null;
    } catch (error) {
      console.error("Failed to restore range:", error);
      return null;
    }
  }

  /**
   * 从 CFI 恢复选区
   */
  private restoreFromCFI(cfi: string): Range | null {
    // 简化实现，实际需要完整解析 CFI
    const match = cfi.match(
      /epubcfi\(\/6\/(\d+)\[(\d+)\],\/6\/(\d+)\[(\d+)\]\)/
    );
    if (!match) return null;

    // 这里需要根据路径找到节点
    // 简化实现
    return null;
  }

  /**
   * 从语义上下文恢复选区
   */
  private restoreFromContext(
    context: string,
    document: Document
  ): Range | null {
    const match = context.match(/\[(.*?)\]/);
    if (!match) return null;

    const highlightText = match[1];
    const beforeText = context.substring(0, match.index || 0);
    const afterText = context.substring((match.index || 0) + match[0].length);

    // 在文档中搜索匹配的文本
    const fullText = document.body.textContent || "";
    const searchPattern = beforeText + highlightText + afterText;
    const index = fullText.indexOf(searchPattern);

    if (index === -1) return null;

    const range = document.createRange();
    const startOffset = index + beforeText.length;
    const endOffset = startOffset + highlightText.length;

    const startNode = this.getTextNodeAtOffset(document.body, startOffset);
    const endNode = this.getTextNodeAtOffset(document.body, endOffset);

    if (startNode && endNode) {
      range.setStart(startNode.node, startNode.offset);
      range.setEnd(endNode.node, endNode.offset);
      return range;
    }

    return null;
  }

  /**
   * 从文本偏移恢复选区
   */
  private restoreFromOffset(offset: number, document: Document): Range | null {
    const nodeInfo = this.getTextNodeAtOffset(document.body, offset);
    if (!nodeInfo) return null;

    const range = document.createRange();
    range.setStart(nodeInfo.node, nodeInfo.offset);
    range.setEnd(nodeInfo.node, nodeInfo.offset);
    return range;
  }

  /**
   * 获取指定偏移量的文本节点
   */
  private getTextNodeAtOffset(
    root: Node,
    offset: number
  ): { node: Text; offset: number } | null {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);

    let currentOffset = 0;
    let node: Node | null;

    while ((node = walker.nextNode())) {
      const textLength = node.textContent?.length || 0;
      if (currentOffset + textLength >= offset) {
        return {
          node: node as Text,
          offset: offset - currentOffset,
        };
      }
      currentOffset += textLength;
    }

    return null;
  }

  /**
   * 创建划线
   */
  createHighlight(
    selection: Selection,
    document: Document,
    color: string = "#ffeb3b",
    note?: string
  ): Highlight | null {
    const position = this.createPosition(selection, document);
    if (!position) return null;

    const highlight: Highlight = {
      id: this.generateId(),
      position,
      text: selection.toString(),
      color,
      note,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    this.highlights.set(highlight.id, highlight);
    return highlight;
  }

  /**
   * 获取所有划线
   */
  getHighlights(): Highlight[] {
    return Array.from(this.highlights.values());
  }

  /**
   * 获取指定划线
   */
  getHighlight(id: string): Highlight | undefined {
    return this.highlights.get(id);
  }

  /**
   * 删除划线
   */
  deleteHighlight(id: string): boolean {
    return this.highlights.delete(id);
  }

  /**
   * 更新划线
   */
  updateHighlight(id: string, updates: Partial<Highlight>): boolean {
    const highlight = this.highlights.get(id);
    if (!highlight) return false;

    this.highlights.set(id, {
      ...highlight,
      ...updates,
      updatedAt: Date.now(),
    });

    return true;
  }

  /**
   * 生成唯一 ID
   */
  private generateId(): string {
    return `highlight-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * 在文档中渲染所有划线
   */
  renderHighlights(document: Document): void {
    this.highlights.forEach((highlight) => {
      const range = this.restoreRange(highlight.position, document);
      if (range) {
        this.applyHighlight(range, highlight);
      }
    });
  }

  /**
   * 应用划线样式
   */
  private applyHighlight(range: Range, highlight: Highlight): void {
    const span = document.createElement("span");
    span.className = "epub-highlight";
    span.style.backgroundColor = highlight.color;
    span.style.opacity = "0.3";
    span.dataset.highlightId = highlight.id;

    try {
      range.surroundContents(span);
    } catch {
      // 如果 surroundContents 失败，使用其他方法
      const contents = range.extractContents();
      span.appendChild(contents);
      range.insertNode(span);
    }
  }
}
