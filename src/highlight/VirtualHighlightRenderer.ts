/**
 * 虚拟滚动划线渲染器
 * 实现虚拟滚动下的实时渲染优化，支持万级划线数据的60fps流畅展示
 */

import type { Highlight } from "./HighlightSystem";
import { HighlightSystem } from "./HighlightSystem";

export interface ViewportInfo {
  scrollTop: number;
  viewportHeight: number;
  contentHeight: number;
}

export interface VisibleRange {
  startIndex: number;
  endIndex: number;
}

export class VirtualHighlightRenderer {
  private highlightSystem: HighlightSystem;
  private highlights: Highlight[] = [];
  private sortedHighlights: Highlight[] = [];
  private visibleHighlights: Set<string> = new Set();

  // 虚拟滚动参数
  private readonly BUFFER_SIZE = 5; // 缓冲区大小（上下额外渲染的划线数量）
  private readonly RENDER_THRESHOLD = 16; // 渲染间隔阈值（毫秒）

  // 性能优化
  private lastRenderTime = 0;
  private rafId: number | null = null;
  private renderQueue: Set<string> = new Set();

  // 批量渲染
  private batchSize = 50; // 每批渲染的划线数量
  private currentBatch = 0;

  constructor(highlightSystem: HighlightSystem) {
    this.highlightSystem = highlightSystem;
  }

  /**
   * 设置划线数据
   */
  setHighlights(highlights: Highlight[]): void {
    this.highlights = highlights;
    // 按位置排序划线（基于文本偏移量）
    this.sortedHighlights = [...highlights].sort(
      (a, b) => a.position.textOffset - b.position.textOffset
    );
  }

  /**
   * 计算可见范围
   */
  calculateVisibleRange(viewport: ViewportInfo): VisibleRange {
    const { scrollTop, viewportHeight } = viewport;

    // 计算可见区域的上下边界（包含缓冲区）
    const startY = Math.max(0, scrollTop - viewportHeight * this.BUFFER_SIZE);
    const endY = scrollTop + viewportHeight * (1 + this.BUFFER_SIZE);

    // 二分查找起始和结束索引
    const startIndex = this.binarySearchByPosition(startY, true);
    const endIndex = this.binarySearchByPosition(endY, false);

    return {
      startIndex: Math.max(0, startIndex),
      endIndex: Math.min(this.sortedHighlights.length, endIndex),
    };
  }

  /**
   * 二分查找划线位置
   */
  private binarySearchByPosition(targetY: number, findStart: boolean): number {
    let left = 0;
    let right = this.sortedHighlights.length - 1;

    while (left <= right) {
      const mid = Math.floor((left + right) / 2);
      const highlight = this.sortedHighlights[mid];
      const highlightY = this.estimateHighlightPosition(highlight);

      if (highlightY < targetY) {
        left = mid + 1;
      } else if (highlightY > targetY) {
        right = mid - 1;
      } else {
        return mid;
      }
    }

    return findStart ? left : right;
  }

  /**
   * 估算划线的Y位置（基于文本偏移量的简单估算）
   */
  private estimateHighlightPosition(highlight: Highlight): number {
    // 这是一个简化的估算，实际应用中可能需要更精确的计算
    // 假设平均每个字符占据约 1.2 行高
    const avgLineHeight = 28; // 平均行高（像素）
    const avgCharsPerLine = 50; // 平均每行字符数

    const estimatedLine = Math.floor(
      highlight.position.textOffset / avgCharsPerLine
    );
    return estimatedLine * avgLineHeight;
  }

  /**
   * 渲染可见划线（使用节流）
   */
  renderVisibleHighlights(document: Document, viewport: ViewportInfo): void {
    const now = performance.now();

    // 节流：如果距离上次渲染时间太短，则推迟渲染
    if (now - this.lastRenderTime < this.RENDER_THRESHOLD) {
      if (this.rafId === null) {
        this.rafId = requestAnimationFrame(() => {
          this.rafId = null;
          this.renderVisibleHighlights(document, viewport);
        });
      }
      return;
    }

    this.lastRenderTime = now;

    // 计算可见范围
    const range = this.calculateVisibleRange(viewport);
    const newVisibleIds = new Set<string>();

    // 收集可见划线ID
    for (let i = range.startIndex; i < range.endIndex; i++) {
      const highlight = this.sortedHighlights[i];
      newVisibleIds.add(highlight.id);
    }

    // 移除不可见的划线
    this.visibleHighlights.forEach((id) => {
      if (!newVisibleIds.has(id)) {
        this.removeHighlightElement(document, id);
        this.visibleHighlights.delete(id);
      }
    });

    // 批量渲染新的可见划线
    const toRender: Highlight[] = [];
    newVisibleIds.forEach((id) => {
      if (!this.visibleHighlights.has(id)) {
        const highlight = this.highlights.find((h) => h.id === id);
        if (highlight) {
          toRender.push(highlight);
          this.visibleHighlights.add(id);
        }
      }
    });

    // 分批渲染
    this.batchRenderHighlights(document, toRender);
  }

  /**
   * 批量渲染划线（避免阻塞主线程）
   */
  private batchRenderHighlights(
    document: Document,
    highlights: Highlight[]
  ): void {
    if (highlights.length === 0) return;

    this.currentBatch = 0;
    this.renderQueue.clear();
    highlights.forEach((h) => this.renderQueue.add(h.id));

    const renderBatch = () => {
      const startTime = performance.now();
      let rendered = 0;

      // 在一帧内尽可能多地渲染
      while (
        this.renderQueue.size > 0 &&
        performance.now() - startTime < 8 // 保留至少 8ms 给其他任务
      ) {
        const id = Array.from(this.renderQueue)[0];
        const highlight = highlights.find((h) => h.id === id);

        if (highlight) {
          this.renderSingleHighlight(document, highlight);
        }

        this.renderQueue.delete(id);
        rendered++;

        if (rendered >= this.batchSize) {
          break;
        }
      }

      // 如果还有未渲染的，下一帧继续
      if (this.renderQueue.size > 0) {
        requestAnimationFrame(renderBatch);
      }
    };

    requestAnimationFrame(renderBatch);
  }

  /**
   * 渲染单个划线
   */
  private renderSingleHighlight(
    document: Document,
    highlight: Highlight
  ): void {
    try {
      // 检查是否已经渲染
      const existing = document.querySelector(
        `[data-highlight-id="${highlight.id}"]`
      );
      if (existing) return;

      // 恢复范围并应用样式
      const range = this.highlightSystem.restoreRange(
        highlight.position,
        document
      );

      if (range) {
        this.applyHighlightStyle(document, range, highlight);
      }
    } catch (error) {
      console.warn(`Failed to render highlight ${highlight.id}:`, error);
    }
  }

  /**
   * 应用划线样式
   */
  private applyHighlightStyle(
    document: Document,
    range: Range,
    highlight: Highlight
  ): void {
    const span = document.createElement("span");
    span.className = "epub-highlight";
    span.style.backgroundColor = highlight.color;
    span.style.opacity = "0.3";
    span.style.transition = "all 0.2s ease";
    span.dataset.highlightId = highlight.id;

    // 添加交互
    span.addEventListener("click", () => {
      this.onHighlightClick(highlight);
    });

    span.addEventListener("mouseenter", () => {
      span.style.opacity = "0.5";
    });

    span.addEventListener("mouseleave", () => {
      span.style.opacity = "0.3";
    });

    try {
      range.surroundContents(span);
    } catch {
      // 如果 surroundContents 失败，使用备选方案
      const contents = range.extractContents();
      span.appendChild(contents);
      range.insertNode(span);
    }
  }

  /**
   * 移除划线元素
   */
  private removeHighlightElement(
    document: Document,
    highlightId: string
  ): void {
    const element = document.querySelector(
      `[data-highlight-id="${highlightId}"]`
    );

    if (element) {
      // 保留文本内容，只移除包装元素
      const textContent = element.textContent || "";
      const textNode = document.createTextNode(textContent);
      element.parentNode?.replaceChild(textNode, element);
    }
  }

  /**
   * 划线点击事件
   */
  private onHighlightClick(highlight: Highlight): void {
    // 可以触发自定义事件或回调
    const event = new CustomEvent("highlightClick", {
      detail: highlight,
    });
    window.dispatchEvent(event);
  }

  /**
   * 清除所有渲染的划线
   */
  clearAllHighlights(document: Document): void {
    this.visibleHighlights.forEach((id) => {
      this.removeHighlightElement(document, id);
    });
    this.visibleHighlights.clear();

    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }

    this.renderQueue.clear();
  }

  /**
   * 获取当前可见划线数量
   */
  getVisibleCount(): number {
    return this.visibleHighlights.size;
  }

  /**
   * 获取总划线数量
   */
  getTotalCount(): number {
    return this.highlights.length;
  }

  /**
   * 性能统计
   */
  getPerformanceStats(): {
    totalHighlights: number;
    visibleHighlights: number;
    renderQueueSize: number;
    lastRenderTime: number;
  } {
    return {
      totalHighlights: this.highlights.length,
      visibleHighlights: this.visibleHighlights.size,
      renderQueueSize: this.renderQueue.size,
      lastRenderTime: this.lastRenderTime,
    };
  }

  /**
   * 销毁
   */
  destroy(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }

    this.highlights = [];
    this.sortedHighlights = [];
    this.visibleHighlights.clear();
    this.renderQueue.clear();
  }
}

/**
 * 创建虚拟滚动观察器
 */
export function createVirtualScrollObserver(
  element: HTMLElement,
  renderer: VirtualHighlightRenderer,
  document: Document
): () => void {
  let ticking = false;

  const handleScroll = () => {
    if (!ticking) {
      requestAnimationFrame(() => {
        const viewport: ViewportInfo = {
          scrollTop: element.scrollTop,
          viewportHeight: element.clientHeight,
          contentHeight: element.scrollHeight,
        };

        renderer.renderVisibleHighlights(document, viewport);
        ticking = false;
      });

      ticking = true;
    }
  };

  // 初始渲染
  handleScroll();

  // 监听滚动事件
  element.addEventListener("scroll", handleScroll, { passive: true });

  // 监听窗口大小变化
  const resizeObserver = new ResizeObserver(handleScroll);
  resizeObserver.observe(element);

  // 返回清理函数
  return () => {
    element.removeEventListener("scroll", handleScroll);
    resizeObserver.disconnect();
    renderer.destroy();
  };
}
