/**
 * 智能工具提示定位器
 * 根据选择区域智能计算 tooltip 位置
 */

export interface TooltipPosition {
  x: number;
  y: number;
}

export class SmartTooltipPositioner {
  private static readonly TOOLTIP_OFFSET = 20; // tooltip 距离划线第一行的固定距离（像素）

  /**
   * 计算 tooltip 位置
   */
  static calculatePosition(
    range: Range,
    container: HTMLElement
  ): TooltipPosition {
    const rect = range.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();

    // 获取第一行的位置（用于垂直定位）
    const firstLineRect = this.getFirstLineRect(range) || rect;

    let tooltipX: number;
    let tooltipY: number;

    // 判断是否占满一行（宽度接近容器宽度）
    const containerWidth = container.clientWidth;
    const isFullLine = rect.width >= containerWidth * 0.9;

    if (isFullLine) {
      // 如果占满一行，水平位置固定在容器中心（容器坐标系）
      tooltipX = containerWidth / 2;
    } else {
      // 否则保持在选区中心（容器坐标系）
      tooltipX = (rect.left - containerRect.left) + rect.width / 2;
    }

    // 垂直方向：在划线第一行上方固定距离（容器坐标系）
    tooltipY = (firstLineRect.top - containerRect.top) - this.TOOLTIP_OFFSET;

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
