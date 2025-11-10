/**
 * 智能工具提示定位器
 * 根据选择区域智能计算 tooltip 位置
 */

export interface TooltipPosition {
  x: number;
  y: number;
}

export class SmartTooltipPositioner {
  private static readonly TOOLTIP_OFFSET = 10; // tooltip 距离划线第一行的固定距离（像素）

  /**
   * 计算 tooltip 位置
   */
  static calculatePosition(
    range: Range,
    container: HTMLElement
  ): TooltipPosition {
    const rect = range.getBoundingClientRect();
    const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
    const scrollLeft =
      window.pageXOffset || document.documentElement.scrollLeft;

    // 获取第一行的位置（用于垂直定位）
    const firstLineRect = this.getFirstLineRect(range);

    let tooltipX: number;
    let tooltipY: number;

    // 判断是否占满一行（宽度接近容器宽度）
    const containerWidth = container.clientWidth || window.innerWidth;
    const isFullLine = rect.width >= containerWidth * 0.9;

    if (isFullLine) {
      // 如果占满一行，水平位置固定在屏幕中心
      tooltipX = scrollLeft + window.innerWidth / 2;
    } else {
      // 否则保持在勾选区域中心
      tooltipX = rect.left + scrollLeft + rect.width / 2;
    }

    // 垂直方向：在划线第一行上方固定距离
    if (firstLineRect) {
      tooltipY = firstLineRect.top + scrollTop - this.TOOLTIP_OFFSET;
    } else {
      // 如果没有第一行信息，使用 range 的顶部
      tooltipY = rect.top + scrollTop - this.TOOLTIP_OFFSET;
    }

    return { x: tooltipX, y: tooltipY };
  }

  /**
   * 获取 Range 第一行的位置信息
   */
  private static getFirstLineRect(range: Range): DOMRect | null {
    try {
      // 创建 Range 的副本
      const firstLineRange = range.cloneRange();

      // 获取第一个文本节点
      let node = range.startContainer;
      if (node.nodeType !== Node.TEXT_NODE) {
        // 如果是元素节点，查找第一个文本节点
        const walker = document.createTreeWalker(
          node,
          NodeFilter.SHOW_TEXT,
          null
        );
        const textNode = walker.nextNode();
        if (!textNode) return null;
        node = textNode;
      }

      // 设置范围从开始位置到第一行结束
      firstLineRange.setStart(node, range.startOffset);

      // 尝试找到第一行的结束位置
      const textNode = node as Text;
      const text = textNode.textContent || "";
      const startOffset = range.startOffset;

      // 查找第一个换行符或段落边界
      let endOffset = text.indexOf("\n", startOffset);
      if (endOffset === -1) {
        // 如果没有换行符，检查是否到达节点末尾
        endOffset = text.length;
      }

      // 如果第一行超出了当前节点，需要扩展到下一个节点
      if (endOffset > textNode.length) {
        endOffset = textNode.length;
      }

      firstLineRange.setEnd(node, Math.min(endOffset, textNode.length));

      // 获取第一行的边界框
      return firstLineRange.getBoundingClientRect();
    } catch (error) {
      console.warn("⚠️ 获取第一行位置失败:", error);
      return null;
    }
  }
}
