/**
 * 高精度划线定位系统
 * 基于XPath的相对路径定位算法
 */

export interface HighlightPosition {
  start: {
    xpath: string; // 相对XPath
    offset: number; // 文本偏移
  };
  end: {
    xpath: string; // 相对XPath
    offset: number; // 文本偏移
  };
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
  public highlights: Map<string, Highlight> = new Map();
  private container: HTMLElement | null = null;

  /**
   * 设置容器元素（用于生成相对XPath）
   */
  setContainer(container: HTMLElement | null): void {
    this.container = container;
  }

  /**
   * 获取元素在同标签兄弟节点中的索引
   */
  private getElementIndexAmongSameTag(el: Element): number {
    let i = 1;
    let sib = el.previousSibling;
    while (sib) {
      if (sib.nodeType === Node.ELEMENT_NODE && sib.nodeName === el.nodeName) {
        i++;
      }
      sib = sib.previousSibling;
    }
    return i;
  }

  /**
   * 获取文本节点在同级文本节点中的索引
   */
  private getTextNodeIndex(textNode: Node): number {
    let i = 1;
    let sib = textNode.previousSibling;
    while (sib) {
      if (sib.nodeType === Node.TEXT_NODE) {
        i++;
      }
      sib = sib.previousSibling;
    }
    return i;
  }

  /**
   * 获取相对XPath（相对于container）
   */
  private getRelativeXPath(node: Node, container: Node): string | null {
    if (!node || !container) return null;
    if (node === container) return ".";

    const parts: string[] = [];
    let cur: Node | null = node;

    while (cur && cur !== container) {
      if (cur.nodeType === Node.TEXT_NODE) {
        // 文本节点：记为 parentXPath + /text()[index]
        const parent: Node | null = cur.parentNode;
        if (!parent) break;
        const idx = this.getTextNodeIndex(cur);
        parts.unshift(`text()[${idx}]`);
        cur = parent;
      } else if (cur.nodeType === Node.ELEMENT_NODE) {
        const idx = this.getElementIndexAmongSameTag(cur as Element);
        parts.unshift(`${cur.nodeName.toLowerCase()}[${idx}]`);
        cur = cur.parentNode;
      } else {
        cur = cur.parentNode;
      }
    }

    if (cur !== container) {
      return null; // 没能追溯到container
    }

    return "." + (parts.length ? "/" + parts.join("/") : "");
  }

  /**
   * 通过相对XPath获取节点
   */
  private getNodeByRelativeXPath(xpath: string, container: Node): Node | null {
    const doc = container.ownerDocument || document;
    try {
      const resolver = doc.createNSResolver(doc.documentElement || doc);
      const result = doc.evaluate(
        xpath,
        container,
        resolver,
        XPathResult.FIRST_ORDERED_NODE_TYPE,
        null
      );
      return result.singleNodeValue;
    } catch (e) {
      console.error("XPath evaluate error", e, xpath);
      return null;
    }
  }

  /**
   * 序列化Range为相对XPath
   */
  serializeRange(range: Range, container: Node): HighlightPosition | null {
    const startXPath = this.getRelativeXPath(range.startContainer, container);
    const endXPath = this.getRelativeXPath(range.endContainer, container);

    if (!startXPath || !endXPath) {
      console.warn("无法序列化范围：节点不在container内");
      return null;
    }

    return {
      start: {
        xpath: startXPath,
        offset: range.startOffset,
      },
      end: {
        xpath: endXPath,
        offset: range.endOffset,
      },
      timestamp: Date.now(),
    };
  }

  /**
   * 反序列化Range（从相对XPath恢复）
   */
  deserializeRange(position: HighlightPosition, container: Node): Range | null {
    const doc = container.ownerDocument || document;
    let startNode = this.getNodeByRelativeXPath(
      position.start.xpath,
      container
    );
    let endNode = this.getNodeByRelativeXPath(position.end.xpath, container);

    if (!startNode || !endNode) {
      console.warn("❌ 找不到序列化的节点", {
        startXPath: position.start.xpath,
        endXPath: position.end.xpath,
        position,
      });
      return null;
    }

    // 验证并修复文本节点
    // 如果文本节点为空，尝试找到包含实际文本的节点
    if (startNode.nodeType === Node.TEXT_NODE) {
      const textLength = (startNode as Text).length;
      if (textLength === 0 || position.start.offset > textLength) {
        console.warn(
          `⚠️ 开始节点文本长度不足: 期望 ${position.start.offset}, 实际 ${textLength}`,
          {
            xpath: position.start.xpath,
            node: startNode,
          }
        );
        // 尝试找到相邻的文本节点或父元素
        startNode = this.findValidTextNode(startNode) || startNode;
      }
    }

    if (endNode.nodeType === Node.TEXT_NODE) {
      const textLength = (endNode as Text).length;
      if (textLength === 0 || position.end.offset > textLength) {
        console.warn(
          `⚠️ 结束节点文本长度不足: 期望 ${position.end.offset}, 实际 ${textLength}`,
          {
            xpath: position.end.xpath,
            node: endNode,
          }
        );
        // 尝试找到相邻的文本节点或父元素
        endNode = this.findValidTextNode(endNode) || endNode;
      }
    }

    const range = doc.createRange();
    try {
      // 再次验证偏移量
      let startOffset = position.start.offset;
      let endOffset = position.end.offset;

      if (startNode.nodeType === Node.TEXT_NODE) {
        const maxStart = (startNode as Text).length;
        if (startOffset > maxStart) {
          console.warn(`⚠️ 调整开始偏移量: ${startOffset} -> ${maxStart}`);
          startOffset = maxStart;
        }
      } else if (startNode.nodeType === Node.ELEMENT_NODE) {
        const maxStart = (startNode as Element).childNodes.length;
        if (startOffset > maxStart) {
          console.warn(`⚠️ 调整开始偏移量: ${startOffset} -> ${maxStart}`);
          startOffset = maxStart;
        }
      }

      if (endNode.nodeType === Node.TEXT_NODE) {
        const maxEnd = (endNode as Text).length;
        if (endOffset > maxEnd) {
          console.warn(`⚠️ 调整结束偏移量: ${endOffset} -> ${maxEnd}`);
          endOffset = maxEnd;
        }
      } else if (endNode.nodeType === Node.ELEMENT_NODE) {
        const maxEnd = (endNode as Element).childNodes.length;
        if (endOffset > maxEnd) {
          console.warn(`⚠️ 调整结束偏移量: ${endOffset} -> ${maxEnd}`);
          endOffset = maxEnd;
        }
      }

      range.setStart(startNode, startOffset);
      range.setEnd(endNode, endOffset);
    } catch (e) {
      console.error("❌ 设置range失败", e, {
        startNode: {
          type: startNode.nodeType,
          name: startNode.nodeName,
          textLength:
            startNode.nodeType === Node.TEXT_NODE
              ? (startNode as Text).length
              : "N/A",
        },
        endNode: {
          type: endNode.nodeType,
          name: endNode.nodeName,
          textLength:
            endNode.nodeType === Node.TEXT_NODE
              ? (endNode as Text).length
              : "N/A",
        },
        position,
      });
      return null;
    }
    return range;
  }

  /**
   * 查找有效的文本节点（当原节点为空时）
   */
  private findValidTextNode(node: Node): Node | null {
    // 如果节点是文本节点但为空，尝试找到相邻的文本节点
    if (node.nodeType === Node.TEXT_NODE && (node as Text).length === 0) {
      // 尝试下一个兄弟节点
      let next = node.nextSibling;
      while (next) {
        if (next.nodeType === Node.TEXT_NODE && (next as Text).length > 0) {
          return next;
        }
        next = next.nextSibling;
      }
      // 尝试上一个兄弟节点
      let prev = node.previousSibling;
      while (prev) {
        if (prev.nodeType === Node.TEXT_NODE && (prev as Text).length > 0) {
          return prev;
        }
        prev = prev.previousSibling;
      }
      // 尝试父元素
      if (node.parentNode) {
        const parent = node.parentNode;
        if (parent.nodeType === Node.ELEMENT_NODE) {
          // 查找父元素内的第一个文本节点
          const walker = document.createTreeWalker(
            parent,
            NodeFilter.SHOW_TEXT,
            null
          );
          const firstText = walker.nextNode();
          if (firstText && (firstText as Text).length > 0) {
            return firstText;
          }
        }
      }
    }
    return null;
  }

  /**
   * 创建高精度定位信息
   */
  createPosition(
    selection: Selection,
    container?: Node
  ): HighlightPosition | null {
    if (!selection.rangeCount) return null;

    const range = selection.getRangeAt(0);
    const containerNode = container || this.container || document.body;

    return this.serializeRange(range, containerNode);
  }

  /**
   * 从定位信息恢复选区（使用XPath，失败时尝试文本匹配）
   */
  restoreRange(
    position: HighlightPosition,
    container?: Node,
    highlightText?: string
  ): Range | null {
    const containerNode = container || this.container || document.body;

    // 首先尝试 XPath 恢复
    let range = this.deserializeRange(position, containerNode);

    // 如果 XPath 恢复失败，且提供了文本内容，尝试文本匹配
    if (
      !range &&
      highlightText &&
      containerNode.nodeType === Node.ELEMENT_NODE
    ) {
      console.log(
        `🔄 XPath恢复失败，尝试文本匹配: "${highlightText.substring(0, 30)}..."`
      );
      range = this.restoreRangeByText(
        highlightText,
        containerNode as HTMLElement
      );
      if (range) {
        console.log(`✅ 文本匹配恢复成功`);
      } else {
        console.warn(`❌ 文本匹配也失败`);
      }
    }

    return range;
  }

  /**
   * 通过文本内容匹配恢复 Range（后备方案）
   */
  private restoreRangeByText(
    text: string,
    container: HTMLElement
  ): Range | null {
    if (!text || !container) return null;

    const normalizedText = text.trim().replace(/\s+/g, " ");
    const containerText = container.textContent || "";
    const normalizedContainerText = containerText.replace(/\s+/g, " ");

    // 查找文本在容器中的位置
    const index = normalizedContainerText.indexOf(normalizedText);
    if (index === -1) {
      // 尝试部分匹配（前20个字符）
      const partialText = normalizedText.substring(
        0,
        Math.min(20, normalizedText.length)
      );
      const partialIndex = normalizedContainerText.indexOf(partialText);
      if (partialIndex === -1) {
        return null;
      }
      // 使用部分匹配的位置
      return this.findRangeByTextOffset(
        container,
        partialIndex,
        partialText.length
      );
    }

    return this.findRangeByTextOffset(container, index, normalizedText.length);
  }

  /**
   * 通过文本偏移量查找 Range
   */
  private findRangeByTextOffset(
    container: HTMLElement,
    textOffset: number,
    length: number
  ): Range | null {
    const walker = document.createTreeWalker(
      container,
      NodeFilter.SHOW_TEXT,
      null
    );

    let currentOffset = 0;
    let startNode: Text | null = null;
    let startOffset = 0;
    let endNode: Text | null = null;
    let endOffset = 0;

    let node: Node | null;
    while ((node = walker.nextNode())) {
      const textNode = node as Text;
      const nodeLength = textNode.length;

      // 检查开始位置是否在这个节点内
      if (!startNode && currentOffset + nodeLength >= textOffset) {
        startNode = textNode;
        startOffset = textOffset - currentOffset;
      }

      // 检查结束位置是否在这个节点内
      if (startNode && currentOffset + nodeLength >= textOffset + length) {
        endNode = textNode;
        endOffset = textOffset + length - currentOffset;
        break;
      }

      currentOffset += nodeLength;
    }

    if (!startNode || !endNode) {
      return null;
    }

    const range = document.createRange();
    try {
      range.setStart(startNode, startOffset);
      range.setEnd(endNode, endOffset);
      return range;
    } catch (e) {
      console.error("❌ 文本匹配创建Range失败", e);
      return null;
    }
  }

  /**
   * 创建划线
   */
  createHighlight(
    selection: Selection,
    container?: Node,
    color: string = "#3b82f6",
    note?: string
  ): Highlight | null {
    const containerNode = container || this.container || document.body;
    const position = this.createPosition(selection, containerNode);
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
   * 将Range包裹进highlight span（容错实现）
   */
  wrapRangeWithHighlight(
    range: Range,
    highlightId: string,
    color: string = "#3b82f6"
  ): HTMLSpanElement | null {
    if (!range || range.collapsed) {
      console.warn("⚠️ wrapRangeWithHighlight: range为空或已折叠");
      return null;
    }

    const doc = range.startContainer.ownerDocument || document;

    const wrapper = doc.createElement("span");
    wrapper.className = "epub-highlight underline";
    wrapper.dataset.highlightId = highlightId;
    wrapper.style.textDecoration = "underline";
    wrapper.style.textDecorationColor = color;
    wrapper.style.textDecorationThickness = "2px";
    wrapper.style.textUnderlineOffset = "3px";
    wrapper.style.cursor = "pointer";
    // 确保划线元素不会阻止链接的点击
    wrapper.style.pointerEvents = "auto";

    // 优先尝试 surroundContents（简单快速）
    try {
      range.surroundContents(wrapper);
      console.log("✅ wrapRangeWithHighlight: 使用surroundContents成功");
      return wrapper;
    } catch (e) {
      // 当 range 跨越多个节点或复杂结构时，surroundContents 可能抛错
      console.log("⚠️ surroundContents失败，使用fallback方法:", e);
      try {
        const contents = range.cloneContents();
        wrapper.appendChild(contents);
        // 删除原内容并插入 wrapper
        range.deleteContents();
        range.insertNode(wrapper);
        console.log("✅ wrapRangeWithHighlight: 使用fallback方法成功");
        return wrapper;
      } catch (fallbackError) {
        console.error(
          "❌ wrapRangeWithHighlight: fallback方法也失败",
          fallbackError
        );
        return null;
      }
    }
  }

  /**
   * 清理已有的highlight spans（恢复时使用）
   */
  clearHighlights(container: HTMLElement): void {
    const existing = container.querySelectorAll("span.epub-highlight");
    existing.forEach((node) => {
      const parent = node.parentNode;
      if (parent) {
        // 将 highlight span 展开成其子节点（移除 wrapper）
        while (node.firstChild) {
          parent.insertBefore(node.firstChild, node);
        }
        parent.removeChild(node);
      }
    });
  }

  /**
   * 在文档中渲染所有划线（增量渲染，不清除已有划线）
   */
  renderHighlights(
    container: HTMLElement,
    clearExisting: boolean = true
  ): void {
    if (!container) {
      console.warn("⚠️ renderHighlights: container为空");
      return;
    }

    console.log(`🎨 renderHighlights: 开始渲染 ${this.highlights.size} 个划线`);

    // 只在明确需要时清理已有的highlight spans（比如章节切换）
    if (clearExisting) {
      this.clearHighlights(container);
      console.log("🧹 已清理已有的highlight spans");
    }

    // 然后按保存的数据恢复
    let successCount = 0;
    let failCount = 0;
    let skipCount = 0;

    this.highlights.forEach((highlight) => {
      // 先检查是否已存在（避免重复渲染）
      const existing = container.querySelector(
        `span.epub-highlight[data-highlight-id="${highlight.id}"]`
      );
      if (existing) {
        console.log(`⏭️ 划线已存在，跳过: ${highlight.id}`);
        skipCount++;
        return;
      }

      console.log(`🔍 尝试恢复划线: ${highlight.id}`, highlight.position);

      const range = this.restoreRange(
        highlight.position,
        container,
        highlight.text
      );
      if (range) {
        console.log(`✅ Range恢复成功: ${highlight.id}`);

        // 检查range是否在container内
        if (!container.contains(range.commonAncestorContainer)) {
          console.warn(`⚠️ Range不在container内: ${highlight.id}`);
          failCount++;
          return;
        }

        try {
          const result = this.wrapRangeWithHighlight(
            range,
            highlight.id,
            highlight.color
          );
          if (result) {
            console.log(`✅ 划线渲染成功: ${highlight.id}`);
            successCount++;
          } else {
            console.warn(`⚠️ wrapRangeWithHighlight返回null: ${highlight.id}`);
            failCount++;
          }
        } catch (e) {
          console.error("❌ 恢复高亮失败", e, highlight);
          failCount++;
        }
      } else {
        console.warn(`⚠️ Range恢复失败: ${highlight.id}`, highlight.position);
        failCount++;
      }
    });

    console.log(
      `📊 划线渲染完成: 成功 ${successCount}, 跳过 ${skipCount}, 失败 ${failCount}`
    );
  }
}
