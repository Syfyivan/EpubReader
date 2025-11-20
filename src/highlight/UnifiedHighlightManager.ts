/**
 * 统一的划线管理器
 * 统一管理划线状态和DOM操作，解决状态管理与DOM操作冲突的问题
 */

import type { StoredHighlight } from "../storage/StorageManager";
import { HighlightSystem } from "./HighlightSystem";

export class UnifiedHighlightManager {
  private highlights: Map<string, StoredHighlight> = new Map();
  private container: HTMLElement | null = null;
  private highlightSystem: HighlightSystem;
  private listeners: Set<() => void> = new Set();

  constructor() {
    this.highlightSystem = new HighlightSystem();
  }

  /**
   * 设置容器元素
   */
  setContainer(container: HTMLElement | null): void {
    if (this.container === container) return;

    this.container = container;
    if (container) {
      this.highlightSystem.setContainer(container);
      // 容器变化时重新渲染所有划线
      this.renderAllHighlights();
    }
  }

  /**
   * 设置所有划线（用于初始化）
   */
  setHighlights(highlights: StoredHighlight[]): void {
    this.highlights.clear();
    highlights.forEach((h) => {
      this.highlights.set(h.id, h);
      this.highlightSystem.highlights.set(h.id, h);
    });

    if (this.container) {
      this.renderAllHighlights();
    }
  }

  /**
   * 添加划线（包含DOM操作）
   */
  addHighlight(highlight: StoredHighlight): boolean {
    if (!this.container) {
      console.warn("⚠️ 容器未设置，无法添加划线");
      return false;
    }

    // 保存到内存
    this.highlights.set(highlight.id, highlight);
    this.highlightSystem.highlights.set(highlight.id, highlight);

    // 立即渲染到DOM
    const success = this.renderHighlightToDOM(highlight);
    if (success) {
      this.notifyListeners();
    }
    return success;
  }

  /**
   * 删除划线
   */
  removeHighlight(highlightId: string): boolean {
    const highlight = this.highlights.get(highlightId);
    if (!highlight) return false;

    // 从内存移除
    this.highlights.delete(highlightId);
    this.highlightSystem.highlights.delete(highlightId);

    // 从DOM移除
    this.removeHighlightFromDOM(highlightId);

    this.notifyListeners();
    return true;
  }

  /**
   * 更新划线
   */
  updateHighlight(
    highlightId: string,
    updates: Partial<StoredHighlight>
  ): boolean {
    const highlight = this.highlights.get(highlightId);
    if (!highlight) return false;

    const updated: StoredHighlight = {
      ...highlight,
      ...updates,
      updatedAt: Date.now(),
    };

    this.highlights.set(highlightId, updated);
    this.highlightSystem.highlights.set(highlightId, updated);

    // 重新渲染
    this.removeHighlightFromDOM(highlightId);
    this.renderHighlightToDOM(updated);

    this.notifyListeners();
    return true;
  }

  /**
   * 获取所有划线
   */
  getHighlights(): StoredHighlight[] {
    return Array.from(this.highlights.values());
  }

  /**
   * 获取指定章节的划线
   */
  getHighlightsByChapter(chapterId: string): StoredHighlight[] {
    return Array.from(this.highlights.values()).filter(
      (h) => h.chapterId === chapterId
    );
  }

  /**
   * 获取指定划线
   */
  getHighlight(highlightId: string): StoredHighlight | undefined {
    return this.highlights.get(highlightId);
  }

  /**
   * 渲染单个划线到DOM
   */
  private renderHighlightToDOM(highlight: StoredHighlight): boolean {
    if (!this.container) return false;

    try {
      // 检查是否已存在
      const existing = this.container.querySelector(
        `span.epub-highlight[data-highlight-id="${highlight.id}"]`
      );
      if (existing) {
        console.log(`⏭️ 划线已存在，跳过: ${highlight.id}`);
        return true;
      }

      const range = this.highlightSystem.restoreRange(
        highlight.position,
        this.container,
        highlight.text
      );

      if (!range) {
        console.warn(`⚠️ 无法恢复Range: ${highlight.id}`);
        return false;
      }

      // 检查 range 是否在 container 内
      if (!this.container.contains(range.commonAncestorContainer)) {
        console.warn(`⚠️ Range不在container内: ${highlight.id}`);
        return false;
      }

      const result = this.highlightSystem.wrapRangeWithHighlight(
        range,
        highlight.id,
        highlight.color
      );

      if (result) {
        // 如果有笔记，插入笔记
        if (highlight.notes && highlight.notes.length > 0) {
          this.highlightSystem.insertNoteAfterHighlight(
            highlight.id,
            this.container
          );
        }
        return true;
      }

      return false;
    } catch (error) {
      console.error("❌ 渲染划线失败:", error, highlight);
      return false;
    }
  }

  /**
   * 从DOM移除划线
   */
  private removeHighlightFromDOM(highlightId: string): void {
    if (!this.container) return;

    // 移除划线元素
    const highlightElement = this.container.querySelector(
      `span.epub-highlight[data-highlight-id="${highlightId}"]`
    );
    if (highlightElement) {
      const parent = highlightElement.parentNode;
      if (parent) {
        // 展开子节点
        while (highlightElement.firstChild) {
          parent.insertBefore(highlightElement.firstChild, highlightElement);
        }
        parent.removeChild(highlightElement);
      }
    }

    // 移除笔记容器
    const noteContainer = this.container.querySelector(
      `.epub-note-container[data-highlight-id="${highlightId}"]`
    );
    if (noteContainer) {
      noteContainer.remove();
    }
  }

  /**
   * 渲染所有划线
   */
  private renderAllHighlights(): void {
    if (!this.container) return;

    console.log(`🎨 渲染所有划线: ${this.highlights.size} 个`);

    // 先清除所有现有划线（章节切换时）
    this.clearAllHighlightsFromDOM();

    // 重新渲染所有划线
    let successCount = 0;
    let failCount = 0;

    this.highlights.forEach((highlight) => {
      if (this.renderHighlightToDOM(highlight)) {
        successCount++;
      } else {
        failCount++;
      }
    });

    console.log(`📊 渲染完成: 成功 ${successCount}, 失败 ${failCount}`);
  }

  /**
   * 清除所有DOM中的划线
   */
  private clearAllHighlightsFromDOM(): void {
    if (!this.container) return;

    // 清除所有划线元素
    const highlights = this.container.querySelectorAll("span.epub-highlight");
    highlights.forEach((node) => {
      const parent = node.parentNode;
      if (parent) {
        while (node.firstChild) {
          parent.insertBefore(node.firstChild, node);
        }
        parent.removeChild(node);
      }
    });

    // 清除所有笔记容器
    const noteContainers = this.container.querySelectorAll(
      ".epub-note-container"
    );
    noteContainers.forEach((container) => container.remove());
  }

  /**
   * 渲染指定章节的划线
   */
  renderChapterHighlights(chapterId: string): void {
    if (!this.container) return;

    const chapterHighlights = this.getHighlightsByChapter(chapterId);
    console.log(`🎨 渲染章节划线: ${chapterHighlights.length} 个`);

    chapterHighlights.forEach((highlight) => {
      this.renderHighlightToDOM(highlight);
    });
  }

  /**
   * 添加监听器（用于通知状态变化）
   */
  addListener(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * 通知所有监听器
   */
  private notifyListeners(): void {
    this.listeners.forEach((listener) => {
      try {
        listener();
      } catch (error) {
        console.error("监听器执行失败:", error);
      }
    });
  }

  /**
   * 获取 HighlightSystem 实例（用于高级操作）
   */
  getHighlightSystem(): HighlightSystem {
    return this.highlightSystem;
  }

  /**
   * 清理资源
   */
  destroy(): void {
    this.highlights.clear();
    this.highlightSystem.highlights.clear();
    this.listeners.clear();
    this.container = null;
  }
}
