/**
 * 智能工具提示组件
 * 根据是否存在划线显示不同的操作选项
 */

import React from 'react';
import type { StoredHighlight } from '../storage/StorageManager';

interface SmartTooltipProps {
  position: { x: number; y: number };
  existingHighlight: StoredHighlight | null;
  onCreate: () => void;
  onRemove: () => void;
  onAddNote?: () => void;
  onAnalyze?: () => void;
}

export const SmartTooltip: React.FC<SmartTooltipProps> = ({
  position,
  existingHighlight,
  onCreate,
  onRemove,
  onAddNote,
  onAnalyze,
}) => {
  if (existingHighlight) {
    // 已存在划线，显示删除和笔记选项
    return (
      <div
        className="highlight-tooltip"
        style={{
          position: 'absolute',
          left: `${position.x}px`,
          top: `${position.y}px`,
          transform: 'translateX(-50%)',
          zIndex: 1000,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="tooltip-actions">
          <button
            className="tooltip-button remove-button"
            onClick={onRemove}
            title="删除划线"
          >
            <span>🗑️</span>
            <span>删除</span>
          </button>
          {onAddNote && (
            <button
              className="tooltip-button note-button"
              onClick={onAddNote}
              title="添加笔记"
            >
              <span>📝</span>
              <span>笔记</span>
            </button>
          )}
          {onAnalyze && (
            <button
              className="tooltip-button analyze-button"
              onClick={onAnalyze}
              title="AI 分析"
            >
              <span>🤖</span>
              <span>分析</span>
            </button>
          )}
        </div>
      </div>
    );
  }

  // 不存在划线，显示创建选项
  return (
    <div
      className="highlight-tooltip"
      style={{
        position: 'absolute',
        left: `${position.x}px`,
        top: `${position.y}px`,
        transform: 'translateX(-50%)',
        zIndex: 1000,
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <button
        className="highlight-button"
        onClick={onCreate}
        title="添加下划线"
      >
        <span className="underline-icon">⎺</span>
        <span>划线</span>
      </button>
    </div>
  );
};

