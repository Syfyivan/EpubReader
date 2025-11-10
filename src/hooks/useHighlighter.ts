/**
 * 划线管理的自定义 Hook
 * 简化划线功能的 React 集成
 */

import { useState, useEffect, useRef, useCallback } from "react";
import type { StoredHighlight } from "../storage/StorageManager";
import { UnifiedHighlightManager } from "../highlight/UnifiedHighlightManager";
import type { StorageManager } from "../storage/StorageManager";

export interface UseHighlighterOptions {
  bookId: string;
  storageManager: StorageManager | null;
}

export interface UseHighlighterReturn {
  highlights: StoredHighlight[];
  createHighlight: (
    range: Range,
    chapterId: string,
    color?: string
  ) => Promise<StoredHighlight | null>;
  removeHighlight: (highlightId: string) => Promise<boolean>;
  updateHighlight: (
    highlightId: string,
    updates: Partial<StoredHighlight>
  ) => Promise<boolean>;
  setContainer: (element: HTMLElement | null) => void;
  contentRef: React.RefObject<HTMLDivElement>;
  manager: UnifiedHighlightManager;
}

export function useHighlighter(
  options: UseHighlighterOptions
): UseHighlighterReturn {
  const { bookId, storageManager } = options;
  const [highlights, setHighlights] = useState<StoredHighlight[]>([]);
  const managerRef = useRef<UnifiedHighlightManager | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  // 初始化管理器
  useEffect(() => {
    if (!storageManager) {
      console.warn("⚠️ StorageManager 未初始化");
      return;
    }

    if (!managerRef.current) {
      managerRef.current = new UnifiedHighlightManager();
    }

    const manager = managerRef.current;

    // 加载已保存的划线
    const loadHighlights = async () => {
      try {
        const saved = await storageManager.getHighlightsByBook(bookId);
        setHighlights(saved);
        manager.setHighlights(saved);
        console.log(`📚 加载了 ${saved.length} 个划线`);
      } catch (error) {
        console.error("加载划线失败:", error);
      }
    };

    loadHighlights();

    // 监听管理器变化
    const unsubscribe = manager.addListener(() => {
      setHighlights(manager.getHighlights());
    });

    return () => {
      unsubscribe();
      manager.destroy();
    };
  }, [bookId, storageManager]);

  // 容器ref回调
  const setContainer = useCallback((element: HTMLElement | null) => {
    if (element) {
      contentRef.current = element;
      managerRef.current?.setContainer(element);
    } else {
      managerRef.current?.setContainer(null);
    }
  }, []);

  // 创建划线
  const createHighlight = useCallback(
    async (
      range: Range,
      chapterId: string,
      color: string = "#3b82f6"
    ): Promise<StoredHighlight | null> => {
      if (!contentRef.current || !managerRef.current || !storageManager) {
        console.warn("⚠️ 容器、管理器或存储管理器未初始化");
        return null;
      }

      const manager = managerRef.current;
      const highlightSystem = manager.getHighlightSystem();

      // 创建 Selection 对象
      const selection = window.getSelection();
      if (!selection) {
        console.warn("⚠️ 无法获取 Selection 对象");
        return null;
      }

      try {
        selection.removeAllRanges();
        selection.addRange(range);
      } catch (e) {
        console.warn("⚠️ 设置 selection 失败:", e);
      }

      // 创建划线
      const highlight = highlightSystem.createHighlight(
        selection,
        contentRef.current,
        color
      );

      if (!highlight) {
        console.warn("⚠️ 创建划线失败");
        return null;
      }

      const storedHighlight: StoredHighlight = {
        ...highlight,
        bookId,
        chapterId,
      };

      // 使用管理器添加划线（包含DOM操作）
      const success = manager.addHighlight(storedHighlight);
      if (success) {
        // 保存到持久化存储
        try {
          await storageManager.saveHighlight(storedHighlight);
          console.log(`💾 已保存划线到 IndexedDB: ${storedHighlight.id}`);
        } catch (error) {
          console.error("保存划线失败:", error);
        }
        return storedHighlight;
      }

      return null;
    },
    [bookId, storageManager]
  );

  // 删除划线
  const removeHighlight = useCallback(
    async (highlightId: string): Promise<boolean> => {
      if (!managerRef.current || !storageManager) return false;

      const success = managerRef.current.removeHighlight(highlightId);
      if (success) {
        try {
          await storageManager.deleteHighlight(highlightId);
          console.log(`🗑️ 已删除划线: ${highlightId}`);
        } catch (error) {
          console.error("删除划线失败:", error);
        }
      }
      return success;
    },
    [storageManager]
  );

  // 更新划线
  const updateHighlight = useCallback(
    async (
      highlightId: string,
      updates: Partial<StoredHighlight>
    ): Promise<boolean> => {
      if (!managerRef.current || !storageManager) return false;

      const success = managerRef.current.updateHighlight(highlightId, updates);
      if (success) {
        const updated = managerRef.current.getHighlight(highlightId);
        if (updated) {
          try {
            await storageManager.saveHighlight(updated);
          } catch (error) {
            console.error("更新划线失败:", error);
          }
        }
      }
      return success;
    },
    [storageManager]
  );

  return {
    highlights,
    createHighlight,
    removeHighlight,
    updateHighlight,
    setContainer,
    contentRef,
    manager: managerRef.current!,
  };
}
