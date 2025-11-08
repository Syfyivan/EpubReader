import * as zip from '@zip.js/zip.js';

/**
 * 流式按需加载引擎
 * 基于 Zip.js 重构文件解析核心，实现章节级动态加载
 */

export interface EpubChapter {
  id: string;
  title: string;
  href: string;
  order: number;
}

export interface EpubMetadata {
  title: string;
  author: string;
  publisher?: string;
  language?: string;
  cover?: string;
  description?: string;
}

export class EpubParser {
  private zipReader: zip.ZipReader | null = null;
  private entries: zip.Entry[] = [];
  private chapters: EpubChapter[] = [];
  private metadata: EpubMetadata = {
    title: '',
    author: '',
  };
  private opfPath: string = '';
  private basePath: string = '';
  private chapterCache: Map<string, string> = new Map();
  private maxCacheSize: number = 10; // 最多缓存10个章节

  /**
   * 加载 EPUB 文件
   * @param source File 对象或 URL 字符串
   */
  async load(source: File | string): Promise<void> {
    try {
      if (typeof source === 'string') {
        // 远程文件 - 使用 HTTP Range Requests
        await this.loadFromUrl(source);
      } else {
        // 本地文件 - 使用 File API
        await this.loadFromFile(source);
      }

      // 解析 EPUB 结构
      await this.parseContainer();
      await this.parseOpf();
    } catch (error) {
      console.error('Failed to load EPUB:', error);
      throw error;
    }
  }

  /**
   * 从本地文件加载
   */
  private async loadFromFile(file: File): Promise<void> {
    const reader = new zip.BlobReader(file);
    this.zipReader = new zip.ZipReader(reader);
    this.entries = await this.zipReader.getEntries();
  }

  /**
   * 从远程 URL 加载（支持 HTTP Range Requests）
   */
  private async loadFromUrl(url: string): Promise<void> {
    const reader = new zip.HttpReader(url, {
      useRangeHeader: true,
      preventHeadRequest: false,
    });
    this.zipReader = new zip.ZipReader(reader);
    this.entries = await this.zipReader.getEntries();
  }

  /**
   * 解析 container.xml 找到 OPF 文件位置
   */
  private async parseContainer(): Promise<void> {
    const containerEntry = this.entries.find(
      (entry) =>
        entry.filename === 'META-INF/container.xml' ||
        entry.filename === 'META-INF\\container.xml'
    );

    if (!containerEntry || !containerEntry.getData) {
      throw new Error('Invalid EPUB: container.xml not found');
    }

    const textWriter = new zip.TextWriter();
    const containerXml = await containerEntry.getData(textWriter);
    
    // 解析 XML 获取 OPF 路径
    const parser = new DOMParser();
    const doc = parser.parseFromString(containerXml, 'text/xml');
    const rootfile = doc.querySelector('rootfile');
    
    if (!rootfile) {
      throw new Error('Invalid EPUB: rootfile not found in container.xml');
    }

    this.opfPath = rootfile.getAttribute('full-path') || '';
    this.basePath = this.opfPath.substring(0, this.opfPath.lastIndexOf('/') + 1);
  }

  /**
   * 解析 OPF 文件获取元数据和章节信息
   */
  private async parseOpf(): Promise<void> {
    const opfEntry = this.entries.find(
      (entry) => entry.filename === this.opfPath
    );

    if (!opfEntry || !opfEntry.getData) {
      throw new Error('Invalid EPUB: OPF file not found');
    }

    const textWriter = new zip.TextWriter();
    const opfXml = await opfEntry.getData(textWriter);
    
    const parser = new DOMParser();
    const doc = parser.parseFromString(opfXml, 'text/xml');

    // 解析元数据
    this.parseMetadata(doc);

    // 解析章节信息
    this.parseManifest(doc);
    this.parseSpine(doc);
  }

  /**
   * 解析元数据
   */
  private parseMetadata(doc: Document): void {
    const metadata = doc.querySelector('metadata');
    if (!metadata) return;

    const getMetaContent = (selector: string): string => {
      const element = metadata.querySelector(selector);
      return element?.textContent?.trim() || '';
    };

    this.metadata = {
      title: getMetaContent('dc\\:title, title'),
      author: getMetaContent('dc\\:creator, creator'),
      publisher: getMetaContent('dc\\:publisher, publisher'),
      language: getMetaContent('dc\\:language, language'),
      description: getMetaContent('dc\\:description, description'),
    };

    // 查找封面图片
    const coverMeta = metadata.querySelector('meta[name="cover"]');
    if (coverMeta) {
      const coverId = coverMeta.getAttribute('content');
      const coverItem = doc.querySelector(`item[id="${coverId}"]`);
      if (coverItem) {
        const coverHref = coverItem.getAttribute('href');
        this.metadata.cover = coverHref || undefined;
      }
    }
  }

  /**
   * 解析 manifest（资源列表）
   */
  private manifestMap: Map<string, string> = new Map();

  private parseManifest(doc: Document): void {
    const manifest = doc.querySelector('manifest');
    if (!manifest) return;

    const items = manifest.querySelectorAll('item');
    items.forEach((item) => {
      const id = item.getAttribute('id');
      const href = item.getAttribute('href');
      if (id && href) {
        this.manifestMap.set(id, href);
      }
    });
  }

  /**
   * 解析 spine（阅读顺序）
   */
  private parseSpine(doc: Document): void {
    const spine = doc.querySelector('spine');
    if (!spine) return;

    const itemrefs = spine.querySelectorAll('itemref');
    this.chapters = [];

    itemrefs.forEach((itemref, index) => {
      const idref = itemref.getAttribute('idref');
      if (!idref) return;

      const href = this.manifestMap.get(idref);
      if (!href) return;

      // 尝试从 manifest 中获取章节标题
      const title = `第 ${index + 1} 章`;
      
      this.chapters.push({
        id: idref,
        title,
        href: this.normalizePath(href),
        order: index,
      });
    });

    // 尝试从 NCX 或 NAV 文件中获取更好的章节标题
    this.enhanceChapterTitles(doc);
  }

  /**
   * 增强章节标题（从 NCX 或 NAV 文件）
   */
  private async enhanceChapterTitles(doc: Document): Promise<void> {
    // 查找 NCX 文件
    const ncxItem = doc.querySelector('item[media-type="application/x-dtbncx+xml"]');
    if (ncxItem) {
      const ncxHref = ncxItem.getAttribute('href');
      if (ncxHref) {
        await this.parseNcx(this.normalizePath(ncxHref));
        return;
      }
    }

    // 查找 NAV 文件
    const navItem = doc.querySelector('item[properties*="nav"]');
    if (navItem) {
      const navHref = navItem.getAttribute('href');
      if (navHref) {
        await this.parseNav(this.normalizePath(navHref));
      }
    }
  }

  /**
   * 解析 NCX 文件获取章节标题
   */
  private async parseNcx(ncxPath: string): Promise<void> {
    const ncxEntry = this.entries.find(
      (entry) => entry.filename === ncxPath
    );

    if (!ncxEntry || !ncxEntry.getData) return;

    try {
      const textWriter = new zip.TextWriter();
      const ncxXml = await ncxEntry.getData(textWriter);
      
      const parser = new DOMParser();
      const doc = parser.parseFromString(ncxXml, 'text/xml');

      const navPoints = doc.querySelectorAll('navPoint');
      navPoints.forEach((navPoint) => {
        const label = navPoint.querySelector('navLabel text');
        const content = navPoint.querySelector('content');
        
        if (label && content) {
          const title = label.textContent?.trim() || '';
          const src = content.getAttribute('src') || '';
          const href = src.split('#')[0]; // 移除锚点

          // 找到对应的章节并更新标题
          const chapter = this.chapters.find((ch) => ch.href.endsWith(href));
          if (chapter && title) {
            chapter.title = title;
          }
        }
      });
    } catch (error) {
      console.warn('Failed to parse NCX:', error);
    }
  }

  /**
   * 解析 NAV 文件获取章节标题
   */
  private async parseNav(navPath: string): Promise<void> {
    const navEntry = this.entries.find(
      (entry) => entry.filename === navPath
    );

    if (!navEntry || !navEntry.getData) return;

    try {
      const textWriter = new zip.TextWriter();
      const navHtml = await navEntry.getData(textWriter);
      
      const parser = new DOMParser();
      const doc = parser.parseFromString(navHtml, 'text/html');

      const navItems = doc.querySelectorAll('nav[*|type="toc"] li, nav#toc li');
      navItems.forEach((item) => {
        const link = item.querySelector('a');
        if (!link) return;

        const title = link.textContent?.trim() || '';
        const href = link.getAttribute('href') || '';
        const cleanHref = href.split('#')[0]; // 移除锚点

        // 找到对应的章节并更新标题
        const chapter = this.chapters.find((ch) => ch.href.endsWith(cleanHref));
        if (chapter && title) {
          chapter.title = title;
        }
      });
    } catch (error) {
      console.warn('Failed to parse NAV:', error);
    }
  }

  /**
   * 规范化路径
   */
  private normalizePath(path: string): string {
    if (path.startsWith('/')) {
      return path.substring(1);
    }
    return this.basePath + path;
  }

  /**
   * 流式加载章节内容
   */
  async loadChapter(chapterId: string): Promise<string> {
    // 检查缓存
    if (this.chapterCache.has(chapterId)) {
      return this.chapterCache.get(chapterId)!;
    }

    const chapter = this.chapters.find((ch) => ch.id === chapterId);
    if (!chapter) {
      throw new Error(`Chapter not found: ${chapterId}`);
    }

    const entry = this.entries.find((e) => e.filename === chapter.href);
    if (!entry || !entry.getData) {
      throw new Error(`Chapter file not found: ${chapter.href}`);
    }

    try {
      const textWriter = new zip.TextWriter();
      const content = await entry.getData(textWriter);

      // 处理 HTML 内容
      const processedContent = this.processChapterContent(content, chapter.href);

      // 缓存管理
      if (this.chapterCache.size >= this.maxCacheSize) {
        // 删除最早的缓存项
        const firstKey = this.chapterCache.keys().next().value;
        this.chapterCache.delete(firstKey);
      }
      this.chapterCache.set(chapterId, processedContent);

      return processedContent;
    } catch (error) {
      console.error('Failed to load chapter:', error);
      throw error;
    }
  }

  /**
   * 处理章节内容（处理相对路径、清理样式等）
   */
  private processChapterContent(html: string, chapterHref: string): string {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    // 获取章节所在目录
    const chapterDir = chapterHref.substring(0, chapterHref.lastIndexOf('/') + 1);

    // 处理图片路径
    const images = doc.querySelectorAll('img');
    images.forEach((img) => {
      const src = img.getAttribute('src');
      if (src && !src.startsWith('http') && !src.startsWith('data:')) {
        const fullPath = this.normalizePath(chapterDir + src);
        // 这里可以转换为 blob URL 或 base64
        img.setAttribute('data-original-src', src);
        img.setAttribute('data-full-path', fullPath);
      }
    });

    // 提取 body 内容
    const body = doc.querySelector('body');
    return body ? body.innerHTML : html;
  }

  /**
   * 加载资源（图片等）
   */
  async loadResource(resourcePath: string): Promise<Blob | null> {
    const entry = this.entries.find((e) => e.filename === resourcePath);
    if (!entry || !entry.getData) {
      return null;
    }

    try {
      const blobWriter = new zip.BlobWriter();
      const blob = await entry.getData(blobWriter);
      return blob;
    } catch (error) {
      console.error('Failed to load resource:', error);
      return null;
    }
  }

  /**
   * 获取章节列表
   */
  getChapters(): EpubChapter[] {
    return this.chapters;
  }

  /**
   * 获取指定章节
   */
  getChapter(chapterId: string): EpubChapter | undefined {
    return this.chapters.find((ch) => ch.id === chapterId);
  }

  /**
   * 获取元数据
   */
  getMetadata(): EpubMetadata {
    return this.metadata;
  }

  /**
   * 获取封面图片
   */
  async getCoverImage(): Promise<Blob | null> {
    if (!this.metadata.cover) return null;
    return await this.loadResource(this.metadata.cover);
  }

  /**
   * 清理资源
   */
  async close(): Promise<void> {
    if (this.zipReader) {
      await this.zipReader.close();
      this.zipReader = null;
    }
    this.entries = [];
    this.chapters = [];
    this.chapterCache.clear();
  }

  /**
   * 预加载相邻章节（优化体验）
   */
  async preloadAdjacentChapters(currentChapterId: string): Promise<void> {
    const currentIndex = this.chapters.findIndex((ch) => ch.id === currentChapterId);
    if (currentIndex === -1) return;

    const preloadTasks: Promise<string>[] = [];

    // 预加载下一章
    if (currentIndex + 1 < this.chapters.length) {
      const nextChapter = this.chapters[currentIndex + 1];
      preloadTasks.push(this.loadChapter(nextChapter.id).catch(() => ''));
    }

    // 预加载上一章
    if (currentIndex - 1 >= 0) {
      const prevChapter = this.chapters[currentIndex - 1];
      preloadTasks.push(this.loadChapter(prevChapter.id).catch(() => ''));
    }

    await Promise.all(preloadTasks);
  }

  /**
   * 获取阅读进度百分比
   */
  getProgress(chapterId: string): number {
    const index = this.chapters.findIndex((ch) => ch.id === chapterId);
    if (index === -1) return 0;
    return ((index + 1) / this.chapters.length) * 100;
  }
}
