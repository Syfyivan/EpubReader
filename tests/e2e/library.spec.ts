import { expect, test } from "@playwright/test";

const seedLibrary = async (page: import("@playwright/test").Page) => {
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("epub-reader-db", 3);
      request.onupgradeneeded = () => {
        const db = request.result;
        const highlightStore = db.createObjectStore("highlights", { keyPath: "id" });
        highlightStore.createIndex("by-book", "bookId");
        highlightStore.createIndex("by-chapter", "chapterId");
        highlightStore.createIndex("by-date", "createdAt");
        highlightStore.createIndex("by-tag", "tags", { multiEntry: true });

        const noteStore = db.createObjectStore("notes", { keyPath: "id" });
        noteStore.createIndex("by-book", "bookId");
        noteStore.createIndex("by-date", "createdAt");
        noteStore.createIndex("by-tag", "tags", { multiEntry: true });

        const bookStore = db.createObjectStore("books", { keyPath: "id" });
        bookStore.createIndex("by-date", "lastReadAt");
        db.createObjectStore("bookFiles", { keyPath: "bookId" });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

    const now = Date.now();
    const tx = db.transaction(["books", "bookFiles", "highlights", "notes"], "readwrite");
    const books = tx.objectStore("books");
    const bookFiles = tx.objectStore("bookFiles");
    const highlights = tx.objectStore("highlights");
    const notes = tx.objectStore("notes");
    books.clear();
    bookFiles.clear();
    highlights.clear();
    notes.clear();

    books.put({
      id: "book-a",
      title: "现代性的展开",
      author: "测试作者 A",
      progress: 0.42,
      lastReadAt: now,
      createdAt: now,
      updatedAt: now,
    });
    books.put({
      id: "book-b",
      title: "自由意志札记",
      author: "测试作者 B",
      progress: 0.18,
      lastReadAt: now - 1000,
      createdAt: now - 1000,
      updatedAt: now - 1000,
    });

    highlights.put({
      id: "highlight-a",
      bookId: "book-a",
      chapterId: "chapter-a",
      chapterTitle: "第一章",
      text: "现代性并不是一个单一概念，它会改变叙事结构与主体经验。",
      color: "#3b82f6",
      tags: ["现代性", "叙事结构"],
      source: "local",
      position: {
        start: { xpath: ".", offset: 0 },
        end: { xpath: ".", offset: 0 },
        timestamp: now,
      },
      createdAt: now,
      updatedAt: now,
    });
    highlights.put({
      id: "highlight-b",
      bookId: "book-b",
      chapterId: "chapter-b",
      chapterTitle: "第二章",
      text: "自由意志的问题总会回到现代性中的责任与选择。",
      color: "#10b981",
      tags: ["自由意志", "现代性"],
      source: "wechat",
      position: {
        start: { xpath: ".", offset: 0 },
        end: { xpath: ".", offset: 0 },
        timestamp: now,
      },
      createdAt: now,
      updatedAt: now,
    });
    notes.put({
      id: "note-a",
      bookId: "book-a",
      title: "主题笔记",
      content: "叙事结构可以作为理解现代性的线索。",
      chapter: "第一章",
      tags: ["现代性", "叙事结构"],
      createdAt: now,
      updatedAt: now,
      source: "local",
    });

    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });

    localStorage.setItem("epub-reader:lastView", "library");
  });
};

test("library search and knowledge graph render seeded annotations", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Epub 智能阅读器" })).toBeVisible();
  await seedLibrary(page);
  await page.reload();

  await expect(page.getByRole("heading", { name: "图书馆" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "全库搜索" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "跨书知识图谱" })).toBeVisible();

  await page.getByLabel("搜索全库内容").fill("现代性");
  await page.getByRole("button", { name: "搜索", exact: true }).click();
  const searchResults = page.locator(".library-search-results");
  await expect(searchResults.getByText("现代性并不是一个单一概念")).toBeVisible();
  await expect(searchResults.getByText("微信读书")).toBeVisible();

  await page.getByRole("button", { name: "生成图谱" }).click();
  await expect(page.getByText("现代性").first()).toBeVisible();
  await expect(page.getByText("自由意志").first()).toBeVisible();
  await expect(page.getByText(/节点 · .*关联/)).toBeVisible();
});
