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

export interface HighlightNote {
  id: string;
  content: string;
  createdAt: number;
  updatedAt: number;
  tags?: string[]; // 标签（可选）
}

export interface HighlightRelation {
  type: "intersect" | "contains" | "contained" | "independent";
  highlightId: string;
}

export interface Highlight {
  id: string;
  position: HighlightPosition;
  text: string;
  color: string;
  note?: string; // 保留向后兼容
  notes?: HighlightNote[]; // 多条笔记
  relations?: HighlightRelation[]; // 与其他划线的关系
  isCrossParagraph?: boolean; // 是否跨段落
  createdAt: number;
  updatedAt: number;
  tags?: string[];
}

type RangeWithOptionalIntersects = Range & {
  intersectsNode?: (node: Node) => boolean;
};

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

    // 安全地检测是否跨段落，如果检测失败不影响划线创建
    let isCrossParagraph = false;
    try {
      const range = selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
      if (range) {
        isCrossParagraph = this.isCrossParagraph(range);
      }
    } catch (error) {
      console.warn("⚠️ 检测跨段落时出错，继续创建划线:", error);
      isCrossParagraph = false;
    }

    const highlight: Highlight = {
      id: this.generateId(),
      position,
      text: selection.toString(),
      color,
      note, // 保留向后兼容
      notes: note
        ? [
            {
              id: this.generateNoteId(),
              content: note,
              createdAt: Date.now(),
              updatedAt: Date.now(),
            },
          ]
        : undefined,
      isCrossParagraph,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    this.highlights.set(highlight.id, highlight);

    // 异步更新与其他划线的关系，不阻塞划线创建
    // 使用 setTimeout 确保划线先创建完成
    setTimeout(() => {
      try {
        // 更新与其他划线的关系
        this.updateRelations(highlight.id);

        // 同时更新其他相关划线的关系（只更新前10个，避免性能问题）
        let count = 0;
        this.highlights.forEach((_other, otherId) => {
          if (otherId !== highlight.id && count < 10) {
            this.updateRelations(otherId);
            count++;
          }
        });
      } catch (error) {
        console.warn("⚠️ 更新划线关系时出错，但不影响划线:", error);
      }
    }, 0);

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
   * 生成笔记 ID
   */
  private generateNoteId(): string {
    return `note-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }


  /**
   * 检测两个划线的关系
   */
  detectRelation(
    highlight1: Highlight,
    highlight2: Highlight
  ): HighlightRelation["type"] | null {
    if (!this.container) return null;

    try {
      const range1 = this.restoreRange(
        highlight1.position,
        this.container,
        highlight1.text
      );
      const range2 = this.restoreRange(
        highlight2.position,
        this.container,
        highlight2.text
      );

      if (!range1 || !range2) return null;

      // 基于 DOM 位置判断关系
      // 计算文本位置（基于容器内的文本偏移）
      const getTextOffset = (range: Range): number => {
        let offset = 0;
        const walker = document.createTreeWalker(
          this.container!,
          NodeFilter.SHOW_TEXT,
          null
        );

        let node: Node | null;
        while ((node = walker.nextNode())) {
          if (node === range.startContainer) {
            offset += range.startOffset;
            break;
          }
          offset += (node as Text).length;
        }
        return offset;
      };

      const start1 = getTextOffset(range1);
      const end1 = start1 + highlight1.text.length;
      const start2 = getTextOffset(range2);
      const end2 = start2 + highlight2.text.length;

      // 判断关系
      if (start1 <= start2 && end1 >= end2) {
        // highlight1 包含 highlight2
        return "contains";
      } else if (start2 <= start1 && end2 >= end1) {
        // highlight2 包含 highlight1
        return "contained";
      } else if (
        (start1 < start2 && end1 > start2 && end1 < end2) ||
        (start2 < start1 && end2 > start1 && end2 < end1)
      ) {
        // 交叉
        return "intersect";
      } else {
        // 独立
        return "independent";
      }
    } catch (error) {
      console.error("检测划线关系失败:", error);
      return null;
    }
  }

  /**
   * 更新划线的关系信息
   */
  updateRelations(highlightId: string): void {
    const highlight = this.highlights.get(highlightId);
    if (!highlight || !this.container) return;

    try {
      const relations: HighlightRelation[] = [];

      // 与所有其他划线比较
      this.highlights.forEach((other, otherId) => {
        if (otherId === highlightId) return;

        try {
          const relationType = this.detectRelation(highlight, other);
          if (relationType) {
            relations.push({
              type: relationType,
              highlightId: otherId,
            });
          }
        } catch (error) {
          // 如果检测关系失败，跳过这个划线
          console.warn(
            `⚠️ 检测划线 ${highlightId} 与 ${otherId} 的关系失败:`,
            error
          );
        }
      });

      highlight.relations = relations;
      this.highlights.set(highlightId, highlight);
    } catch (error) {
      // 如果更新关系失败，不影响划线本身
      console.warn(`⚠️ 更新划线 ${highlightId} 的关系信息失败:`, error);
    }
  }

  /**
   * 添加笔记到划线
   */
  addNote(highlightId: string, noteContent: string): HighlightNote | null {
    const highlight = this.highlights.get(highlightId);
    if (!highlight) return null;

    const note: HighlightNote = {
      id: this.generateNoteId(),
      content: noteContent,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    if (!highlight.notes) {
      highlight.notes = [];
    }
    highlight.notes.push(note);
    highlight.updatedAt = Date.now();

    this.highlights.set(highlightId, highlight);
    return note;
  }

  /**
   * 删除笔记
   */
  deleteNote(highlightId: string, noteId: string): boolean {
    const highlight = this.highlights.get(highlightId);
    if (!highlight || !highlight.notes) return false;

    const index = highlight.notes.findIndex((n) => n.id === noteId);
    if (index === -1) return false;

    highlight.notes.splice(index, 1);
    highlight.updatedAt = Date.now();
    this.highlights.set(highlightId, highlight);
    return true;
  }

  /**
   * 更新笔记
   */
  updateNote(highlightId: string, noteId: string, content: string): boolean {
    const highlight = this.highlights.get(highlightId);
    if (!highlight || !highlight.notes) return false;

    const note = highlight.notes.find((n) => n.id === noteId);
    if (!note) return false;

    note.content = content;
    note.updatedAt = Date.now();
    highlight.updatedAt = Date.now();
    this.highlights.set(highlightId, highlight);
    return true;
  }

  /**
   * 在划线下一行插入笔记元素
   * @param highlightId 划线 ID
   * @param container 容器元素
   * @returns 笔记容器元素
   */
  insertNoteAfterHighlight(
    highlightId: string,
    container: HTMLElement
  ): HTMLElement | null {
    const highlight = this.highlights.get(highlightId);
    if (!highlight || !this.container) return null;

    // 查找划线元素
    const highlightElement = container.querySelector(
      `span.epub-highlight[data-highlight-id="${highlightId}"]`
    ) as HTMLElement;

    if (!highlightElement) {
      // 如果划线元素不存在，尝试恢复并渲染
      const range = this.restoreRange(
        highlight.position,
        container,
        highlight.text
      );
      if (range) {
        this.wrapRangeWithHighlight(range, highlightId, highlight.color);
        // 重新查找
        const newElement = container.querySelector(
          `span.epub-highlight[data-highlight-id="${highlightId}"]`
        ) as HTMLElement;
        if (newElement) {
          return this.insertNoteElementAfter(newElement, highlight);
        }
      }
      return null;
    }

    return this.insertNoteElementAfter(highlightElement, highlight);
  }

  /**
   * 在元素后插入笔记元素
   */
  private insertNoteElementAfter(
    highlightElement: HTMLElement,
    highlight: Highlight
  ): HTMLElement | null {
    if (!highlight.notes || highlight.notes.length === 0) return null;

    // 检查是否已存在笔记容器
    const existingNoteContainer =
      highlightElement.nextElementSibling as HTMLElement;
    if (
      existingNoteContainer &&
      existingNoteContainer.classList.contains("epub-note-container")
    ) {
      // 更新现有笔记容器
      this.updateNoteContainer(existingNoteContainer, highlight.notes);
      return existingNoteContainer;
    }

    // 创建笔记容器
    const noteContainer = document.createElement("div");
    noteContainer.className = "epub-note-container";
    noteContainer.dataset.highlightId = highlight.id;
    noteContainer.style.marginTop = "8px";
    noteContainer.style.marginBottom = "8px";
    noteContainer.style.padding = "8px";
    noteContainer.style.backgroundColor = "#f9fafb";
    noteContainer.style.borderLeft = "3px solid #3b82f6";
    noteContainer.style.borderRadius = "4px";

    // 插入笔记内容
    this.updateNoteContainer(noteContainer, highlight.notes);

    // 插入到划线元素后
    if (highlightElement.parentNode) {
      highlightElement.parentNode.insertBefore(
        noteContainer,
        highlightElement.nextSibling
      );
    } else {
      // 如果父节点不存在，尝试在下一个兄弟节点前插入
      let nextSibling = highlightElement.nextSibling;
      while (nextSibling && nextSibling.nodeType !== Node.ELEMENT_NODE) {
        nextSibling = nextSibling.nextSibling;
      }
      if (nextSibling && nextSibling.parentNode) {
        nextSibling.parentNode.insertBefore(noteContainer, nextSibling);
      } else {
        // 如果找不到合适的位置，在父节点末尾插入
        highlightElement.parentElement?.appendChild(noteContainer);
      }
    }

    return noteContainer;
  }

  /**
   * 更新笔记容器内容
   */
  private updateNoteContainer(
    container: HTMLElement,
    notes: Highlight["notes"]
  ): void {
    if (!notes || notes.length === 0) {
      container.style.display = "none";
      return;
    }

    container.style.display = "block";
    container.innerHTML = "";

    // 按创建时间排序，顺序叠加显示
    const sortedNotes = [...notes].sort((a, b) => a.createdAt - b.createdAt);

    sortedNotes.forEach((note, index) => {
      const noteElement = document.createElement("div");
      noteElement.className = "epub-note-item";
      noteElement.dataset.noteId = note.id;
      noteElement.style.marginBottom =
        index < sortedNotes.length - 1 ? "8px" : "0";
      noteElement.style.padding = "4px 0";
      noteElement.style.fontSize = "14px";
      noteElement.style.color = "#374151";
      noteElement.style.lineHeight = "1.5";
      noteElement.textContent = note.content;

      container.appendChild(noteElement);
    });
  }

  /**
   * 渲染所有划线的笔记
   */
  renderAllNotes(container: HTMLElement): void {
    this.highlights.forEach((highlight) => {
      if (highlight.notes && highlight.notes.length > 0) {
        this.insertNoteAfterHighlight(highlight.id, container);
      }
    });
  }

  /**
   * 将Range包裹进highlight span（容错实现，不改变段落结构）
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

    // 检查是否跨段落
    const isCrossParagraph = this.isCrossParagraph(range);

    if (isCrossParagraph) {
      // 跨段落情况：遍历所有文本节点，只对文本节点添加下划线
      console.log("📝 检测到跨段落选择，使用精细方法处理");
      const result = this.wrapCrossParagraphRange(range, highlightId, color);
      if (!result) {
        console.error("❌ wrapCrossParagraphRange 返回 null，跨段落划线失败");
      }
      return result;
    }

    // 单段落情况：优先尝试 surroundContents（简单快速）
    const wrapper = doc.createElement("span");
    wrapper.className = "epub-highlight underline";
    wrapper.dataset.highlightId = highlightId;
    wrapper.style.textDecoration = "underline";
    wrapper.style.textDecorationColor = color;
    wrapper.style.textDecorationThickness = "2px";
    wrapper.style.textUnderlineOffset = "3px";
    wrapper.style.cursor = "pointer";
    wrapper.style.display = "inline"; // 确保不改变布局
    wrapper.style.pointerEvents = "auto";

    try {
      range.surroundContents(wrapper);
      console.log("✅ wrapRangeWithHighlight: 使用surroundContents成功");
      return wrapper;
    } catch (e) {
      // 当 range 跨越多个节点或复杂结构时，使用精细方法
      console.log("⚠️ surroundContents失败，使用精细方法:", e);
      return this.wrapCrossParagraphRange(range, highlightId, color);
    }
  }

  /**
   * 检查 Range 是否跨段落
   */
  private isCrossParagraph(range: Range): boolean {
    const startContainer = range.startContainer;
    const endContainer = range.endContainer;

    // 如果开始和结束容器不同，可能跨段落
    if (startContainer !== endContainer) {
      const blockElements = [
        "P", "DIV", "H1", "H2", "H3", "H4", "H5", "H6", "LI", "BLOCKQUOTE",
      ];

      let startBlock: Element | null = null;
      let endBlock: Element | null = null;

      // 查找开始和结束的块级元素
      let node: Node | null = startContainer;
      while (node && node !== document.body) {
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
      while (node && node !== document.body) {
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
      return startBlock !== null && endBlock !== null && startBlock !== endBlock;
    }

    return false;
  }

  /**
   * 包装跨段落的 Range（只对文本节点添加下划线，不改变段落结构）
   */
  private wrapCrossParagraphRange(
    range: Range,
    highlightId: string,
    color: string
  ): HTMLSpanElement | null {
    const doc = range.startContainer.ownerDocument || document;
    const root: Node = this.container || range.commonAncestorContainer || doc.body;
    const rangeWithIntersects = range as RangeWithOptionalIntersects;

    const wrappers: HTMLSpanElement[] = [];

    // 收集与 range 相交的文本节点
    type TextNodeInfo = { node: Text; startOffset: number; endOffset: number };
    const textNodesToProcess: TextNodeInfo[] = [];

    const iterator = doc.createNodeIterator(root, NodeFilter.SHOW_TEXT);
    let n: Node | null;
    let total = 0;
    while ((n = iterator.nextNode())) {
      total++;
      const textNode = n as Text;
      if (!textNode.parentNode) continue;
      const text = textNode.nodeValue || "";
      if (text.length === 0) continue;

      // 判断是否与所选范围相交
      let intersects = false;
      if (typeof rangeWithIntersects.intersectsNode === "function") {
        try {
          intersects = rangeWithIntersects.intersectsNode(textNode);
        } catch {
          intersects = false;
        }
      } else {
        // Fallback: 利用 selectNodeContents + compareBoundaryPoints
        const textRange = doc.createRange();
        textRange.selectNodeContents(textNode);
        const endBeforeStart =
          textRange.compareBoundaryPoints(Range.END_TO_START, range) < 0;
        const startAfterEnd =
          textRange.compareBoundaryPoints(Range.START_TO_END, range) > 0;
        intersects = !(endBeforeStart || startAfterEnd);
      }

      if (!intersects) continue;

      // 计算在该文本节点内的起止偏移
      const startOffset =
        range.startContainer === textNode ? range.startOffset : 0;
      const endOffset =
        range.endContainer === textNode ? range.endOffset : textNode.length;

      if (startOffset < endOffset) {
        textNodesToProcess.push({ node: textNode, startOffset, endOffset });
      }
    }

    console.log(
      `🔍 wrapCrossParagraphRange: 遍历了 ${total} 个文本节点，找到 ${textNodesToProcess.length} 个需要处理的节点`
    );

    let firstWrapper: HTMLSpanElement | null = null;
    for (const { node: textNode, startOffset, endOffset } of textNodesToProcess) {
      if (!textNode.parentNode) continue;

      const wrapper = doc.createElement("span");
      wrapper.className = "epub-highlight underline";
      wrapper.dataset.highlightId = highlightId;
      wrapper.style.textDecoration = "underline";
      wrapper.style.textDecorationColor = color;
      wrapper.style.textDecorationThickness = "2px";
      wrapper.style.textUnderlineOffset = "3px";
      wrapper.style.cursor = "pointer";
      wrapper.style.display = "inline";
      wrapper.style.pointerEvents = "auto";

      try {
        if (startOffset === 0 && endOffset === textNode.length) {
          const parent = textNode.parentNode;
          if (parent) {
            parent.replaceChild(wrapper, textNode);
            wrapper.appendChild(textNode);
          }
        } else {
          // 正确的三段切分：原(textNode) -> pre | selected | post
          const pre = textNode.splitText(startOffset);
          const post = pre.splitText(endOffset - startOffset);
          const selected = pre;

          const parent = selected.parentNode;
          if (parent) {
            parent.replaceChild(wrapper, selected);
            wrapper.appendChild(selected);
            if (post && post.parentNode && wrapper.parentNode) {
              wrapper.parentNode.insertBefore(post, wrapper.nextSibling);
            }
          }
        }

        if (!firstWrapper) firstWrapper = wrapper;
        wrappers.push(wrapper);
      } catch (e) {
        console.warn("⚠️ 处理文本节点失败:", e, textNode);
      }
    }

    if (wrappers.length > 0) {
      console.log(
        `✅ wrapCrossParagraphRange: 成功创建 ${wrappers.length} 个下划线片段`
      );
      return firstWrapper;
    }

    console.warn("⚠️ wrapCrossParagraphRange: 未找到有效的文本节点");
    return null;
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
