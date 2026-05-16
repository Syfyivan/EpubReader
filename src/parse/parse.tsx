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
  level?: number; // 层级深度，用于显示缩进
  parentId?: string; // 父级ID
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
  private zipReader: zip.ZipReader<zip.Reader<unknown>> | null = null;
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

  // 类型守卫：判断是否为文件条目（具有 getData 方法）
  private isFileEntry(entry: zip.Entry): entry is zip.FileEntry {
    return !!entry && 'getData' in (entry as object);
  }

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

    if (!containerEntry || !this.isFileEntry(containerEntry)) {
      throw new Error('Invalid EPUB: container.xml not found');
    }

    const textWriter = new zip.TextWriter();
    // 这行代码是用来读取 container.xml 文件的内容的, 意思是把 container.xml 文件的内容读取出来, 并返回一个字符串
    const containerXml = await containerEntry.getData(textWriter);
    
    // 解析 XML 获取 OPF 路径
    const parser = new DOMParser();
    const doc = parser.parseFromString(containerXml, 'text/xml'); // 这里的 DOMParser.parseFromString 是浏览器内置 Web API，用于把字符串解析成 DOM（可以是 XML 或 HTML）, 这行代码是用来解析 container.xml 文件的, 意思是把 container.xml 文件的内容解析成一个 DOM 对象, 'text/xml'是解析的文件类型, 这里解析的是 XML 文件
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

    if (!opfEntry || !this.isFileEntry(opfEntry)) {
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

    console.log('📚 初始章节列表:', this.chapters.map(ch => `${ch.id}: ${ch.title} -> ${ch.href}`));

    // 等待目录解析完成
    await this.enhanceChapterTitles(doc);

    console.log('📚 增强后章节列表:', this.chapters.map(ch => `${ch.id}: ${ch.title} -> ${ch.href}`));
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

      // 不设置默认标题，等待 NCX/NAV 中的真实标题
      // 如果识别不到章节名字，标题将为空，稍后会被过滤掉
      const normalizedHref = this.normalizePath(href);
      
      this.chapters.push({
        id: idref,
        title: '', // 初始为空，等待NCX/NAV解析
        href: normalizedHref,
        order: index,
      });
    });
  }

  /**
   * 增强章节标题（从 NCX 或 NAV 文件）
   */
  private async enhanceChapterTitles(doc: Document): Promise<void> {
    console.log('🔍 开始增强章节标题...');
    
    // 查找 NCX 文件
    const ncxItem = doc.querySelector('item[media-type="application/x-dtbncx+xml"]');
    if (ncxItem) {
      const ncxHref = ncxItem.getAttribute('href');
      if (ncxHref) {
        console.log('📖 找到NCX文件:', ncxHref);
        await this.parseNcx(this.normalizePath(ncxHref));
        return;
      }
    }

    // 查找 NAV 文件（多种方式）
    let navItem = doc.querySelector('item[properties*="nav"]');
    if (!navItem) {
      // 尝试其他选择器
      navItem = doc.querySelector('item[id*="nav"], item[id*="toc"]');
    }
    if (!navItem) {
      // 尝试通过文件名查找
      const allItems = doc.querySelectorAll('item');
      for (const item of Array.from(allItems)) {
        const href = item.getAttribute('href');
        if (href && (href.toLowerCase().includes('nav') || href.toLowerCase().includes('toc'))) {
          navItem = item;
          break;
        }
      }
    }

    if (navItem) {
      const navHref = navItem.getAttribute('href');
      if (navHref) {
        console.log('📖 找到NAV文件:', navHref);
        await this.parseNav(this.normalizePath(navHref));
      } else {
        console.warn('⚠️ NAV项缺少href属性');
      }
    } else {
      console.warn('⚠️ 未找到NCX或NAV文件，将使用默认标题');
    }
  }

  /**
   * 解析 NCX 文件获取章节标题
   */
  private async parseNcx(ncxPath: string): Promise<void> {
    const ncxEntry = this.entries.find(
      (entry) => entry.filename === ncxPath
    );

    if (!ncxEntry || !this.isFileEntry(ncxEntry)) {
      console.warn('⚠️ NCX文件未找到或无法读取:', ncxPath);
      return;
    }

    try {
      const textWriter = new zip.TextWriter();
      const ncxXml = await ncxEntry.getData(textWriter);
      
      const parser = new DOMParser();
      const doc = parser.parseFromString(ncxXml, 'text/xml'); // 这里的 DOMParser.parseFromString 是浏览器内置 Web API，用于把字符串解析成 DOM（可以是 XML 或 HTML）

      // 检查解析错误
      const parserError = doc.querySelector('parsererror');
      if (parserError) {
        console.warn('⚠️ NCX XML解析错误:', parserError.textContent);
        return;
      }

      // 递归解析navPoint，支持层次结构
      const parseNavPoint = (navPoint: Element, level: number = 0, parentId?: string): void => {
        const label = navPoint.querySelector('navLabel text');
        const content = navPoint.querySelector('content');
        
        if (label && content) {
          const title = label.textContent?.trim() || '';
          const src = content.getAttribute('src') || '';
          const href = src.split('#')[0]; // 移除锚点
          const normalizedHref = this.normalizePath(href);

          if (!title) {
            console.warn('⚠️ 导航点缺少标题:', src);
            return;
          }

          // 生成唯一ID（如果没有对应的章节ID）
          const navPointId = navPoint.getAttribute('id') || `nav-${Date.now()}-${Math.random()}`;

          // 找到对应的章节并更新标题
          const chapter = this.chapters.find((ch) => {
            // 完全匹配
            if (ch.href === normalizedHref) return true;
            // 文件名匹配（忽略路径差异）
            const chFileName = ch.href.split('/').pop()?.toLowerCase();
            const hrefFileName = normalizedHref.split('/').pop()?.toLowerCase();
            if (chFileName && hrefFileName && chFileName === hrefFileName) return true;
            // 相对路径匹配
            const chRelative = ch.href.replace(/^[^/]+\//, '');
            const hrefRelative = normalizedHref.replace(/^[^/]+\//, '');
            return chRelative === hrefRelative;
          });
          
          if (chapter) {
            // 更新现有章节（只更新有实际章节文件的）
            if (title && title.trim()) {
              chapter.title = title;
              chapter.level = level;
              if (parentId) chapter.parentId = parentId;
              console.log(`✅ [L${level}] 匹配: "${title}" -> ${chapter.href}`);
            }
          } else {
            // 不添加没有对应实际章节的目录项（如注释、目录等）
            console.log(`⏭️ [L${level}] 跳过目录项（无对应章节）: "${title}" -> ${normalizedHref}`);
          }

          // 递归处理子导航点
          const childNavPoints = navPoint.querySelectorAll(':scope > navPoint');
          childNavPoints.forEach((childNavPoint) => {
            parseNavPoint(childNavPoint, level + 1, navPointId);
          });
        }
      };

      // 获取所有顶级navPoint
      const topNavPoints = doc.querySelectorAll('navMap > navPoint');
      console.log(`📖 找到 ${topNavPoints.length} 个顶级导航点`);

      // 如果没有顶级navPoint，尝试查找所有navPoint
      const allNavPoints = topNavPoints.length > 0 
        ? topNavPoints 
        : doc.querySelectorAll('navPoint');

      console.log(`📖 总共找到 ${allNavPoints.length} 个导航点`);

      // 解析所有导航点
      allNavPoints.forEach((navPoint) => {
        parseNavPoint(navPoint, 0);
      });

      // 按order排序，保持spine顺序
      this.chapters.sort((a, b) => {
        // 有order的按order排序，没有order的排在后面
        if (a.order !== undefined && b.order !== undefined) {
          return a.order - b.order;
        }
        if (a.order !== undefined) return -1;
        if (b.order !== undefined) return 1;
        return 0;
      });

      console.log(`📊 NCX解析完成: 共 ${this.chapters.length} 个章节/目录项`);
    } catch (error) {
      console.error('❌ Failed to parse NCX:', error);
    }
  }

  /**
   * 解析 NAV 文件获取章节标题
   */
  private async parseNav(navPath: string): Promise<void> {
    const navEntry = this.entries.find(
      (entry) => entry.filename === navPath
    );

    if (!navEntry || !this.isFileEntry(navEntry)) {
      console.warn('⚠️ NAV文件未找到或无法读取:', navPath);
      return;
    }

    try {
      const textWriter = new zip.TextWriter();
      const navHtml = await navEntry.getData(textWriter);
      
      const parser = new DOMParser();
      const doc = parser.parseFromString(navHtml, 'text/html');

      // 递归解析NAV列表项，支持层次结构
      const parseNavItem = (item: Element, level: number = 0, parentId?: string): void => {
        const link = item.querySelector('a');
        if (!link) return;

        const title = link.textContent?.trim() || '';
        const href = link.getAttribute('href') || '';
        const cleanHref = href.split('#')[0]; // 移除锚点
        const normalizedHref = this.normalizePath(cleanHref);

        if (!title) {
          console.warn('⚠️ NAV项缺少标题:', href);
          return;
        }

        // 生成唯一ID
        const navItemId = item.id || link.id || `nav-${Date.now()}-${Math.random()}`;

        // 找到对应的章节并更新标题
        const chapter = this.chapters.find((ch) => {
          // 完全匹配
          if (ch.href === normalizedHref) return true;
          // 文件名匹配（忽略路径差异）
          const chFileName = ch.href.split('/').pop()?.toLowerCase();
          const hrefFileName = normalizedHref.split('/').pop()?.toLowerCase();
          if (chFileName && hrefFileName && chFileName === hrefFileName) return true;
          // 相对路径匹配
          const chRelative = ch.href.replace(/^[^/]+\//, '');
          const hrefRelative = normalizedHref.replace(/^[^/]+\//, '');
          return chRelative === hrefRelative;
        });
        
        if (chapter) {
          // 更新现有章节（只更新有实际章节文件的）
          if (title && title.trim()) {
            chapter.title = title;
            chapter.level = level;
            if (parentId) chapter.parentId = parentId;
            console.log(`✅ [L${level}] NAV匹配: "${title}" -> ${chapter.href}`);
          }
        } else {
          // 不添加没有对应实际章节的目录项（如注释、目录等）
          console.log(`⏭️ [L${level}] NAV跳过目录项（无对应章节）: "${title}" -> ${normalizedHref}`);
        }

        // 递归处理子列表项
        const childItems = item.querySelectorAll(':scope > ol > li, :scope > ul > li');
        childItems.forEach((childItem) => {
          parseNavItem(childItem, level + 1, navItemId);
        });
      };

      // 获取NAV容器
      const navContainer = doc.querySelector('nav[*|type="toc"], nav#toc');
      if (!navContainer) {
        console.warn('⚠️ 未找到NAV容器');
        return;
      }

      // 获取所有顶级列表项
      const topItems = navContainer.querySelectorAll(':scope > ol > li, :scope > ul > li');
      console.log(`📖 找到 ${topItems.length} 个顶级NAV项`);

      // 如果没有顶级项，尝试查找所有li
      const allItems = topItems.length > 0 
        ? topItems 
        : navContainer.querySelectorAll('li');

      console.log(`📖 总共找到 ${allItems.length} 个NAV项`);

      // 解析所有列表项
      allItems.forEach((item) => {
        parseNavItem(item, 0);
      });

      // 按order排序，保持spine顺序
      this.chapters.sort((a, b) => {
        if (a.order !== undefined && b.order !== undefined) {
          return a.order - b.order;
        }
        if (a.order !== undefined) return -1;
        if (b.order !== undefined) return 1;
        return 0;
      });

      console.log(`📊 NAV解析完成: 共 ${this.chapters.length} 个章节/目录项`);
    } catch (error) {
      console.error('❌ Failed to parse NAV:', error);
    }
  }

  /**
   * 规范化路径
   */
  private normalizePath(path: string): string {
    if (!path) return '';
    
    // 移除开头的斜杠
    let normalized = path.startsWith('/') ? path.substring(1) : path;
    
    // 如果路径不包含basePath，则添加
    if (this.basePath && !normalized.startsWith(this.basePath)) {
      normalized = this.basePath + normalized;
    }
    
    // 统一路径分隔符
    normalized = normalized.replace(/\\/g, '/');
    
    // 移除重复的斜杠
    normalized = normalized.replace(/\/+/g, '/');

    const parts: string[] = [];
    normalized.split('/').forEach((part) => {
      if (!part || part === '.') return;
      if (part === '..') {
        parts.pop();
        return;
      }
      parts.push(part);
    });
    
    return parts.join('/');
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
    if (!entry || !this.isFileEntry(entry)) {
      throw new Error(`Chapter file not found: ${chapter.href}`);
    }

    try {
      const textWriter = new zip.TextWriter();
      const content = await entry.getData(textWriter);

      // 处理 HTML 内容
      const processedContent = await this.processChapterContent(content, chapter.href);

      // 缓存管理
      if (this.chapterCache.size >= this.maxCacheSize) {
        // 删除最早的缓存项
        const first = this.chapterCache.keys().next();
        if (!first.done && first.value !== undefined) {
          this.chapterCache.delete(first.value as string);
        }
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
  private async processChapterContent(html: string, chapterHref: string): Promise<string> {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    // 获取章节所在目录
    const chapterDir = chapterHref.substring(0, chapterHref.lastIndexOf('/') + 1);
    const transparentPixel =
      'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';

    const isExternalResource = (value: string) =>
      /^(https?:|data:|blob:|mailto:|tel:|#)/i.test(value.trim());

    const resolveResourcePath = (value: string, baseDir: string = chapterDir) => {
      const cleanValue = value.trim().replace(/^['"]|['"]$/g, '').split('#')[0];
      if (!cleanValue || isExternalResource(cleanValue)) return '';
      return this.normalizePath(baseDir + cleanValue);
    };

    const markSrc = (element: Element, attr: string, dataAttr: string, baseDir = chapterDir) => {
      const value = element.getAttribute(attr);
      if (!value || isExternalResource(value)) return;
      const fullPath = resolveResourcePath(value, baseDir);
      if (!fullPath) return;
      element.setAttribute(`data-original-${attr}`, value);
      element.setAttribute(dataAttr, fullPath);
	      if (attr === 'src') {
	        element.setAttribute(attr, transparentPixel);
	      } else if (attr === 'poster') {
	        element.removeAttribute(attr);
	      } else if (attr === 'data') {
	        element.removeAttribute(attr);
	      }
	    };

    const parseSrcset = (srcset: string, baseDir = chapterDir) =>
      srcset
        .split(',')
        .map((part) => {
          const trimmed = part.trim();
          if (!trimmed) return null;
          const [url, ...descriptorParts] = trimmed.split(/\s+/);
          const path = resolveResourcePath(url, baseDir);
          if (!path) return null;
          return {
            path,
            descriptor: descriptorParts.join(' '),
          };
        })
        .filter((item): item is { path: string; descriptor: string } => item !== null);

    const markSrcset = (element: Element, baseDir = chapterDir) => {
      const srcset = element.getAttribute('srcset');
      if (!srcset) return;
      const entries = parseSrcset(srcset, baseDir);
      if (entries.length === 0) return;
      element.setAttribute('data-original-srcset', srcset);
      element.setAttribute('data-epub-srcset', JSON.stringify(entries));
      element.removeAttribute('srcset');
    };

    const markInlineStyle = (element: Element, baseDir = chapterDir) => {
      const style = element.getAttribute('style');
      if (!style || !/url\(/i.test(style)) return;
      element.setAttribute('data-epub-style-original', style);
      element.setAttribute('data-epub-style-base', baseDir);
    };

    const inlineStylesheet = async (link: HTMLLinkElement) => {
      const href = link.getAttribute('href');
      if (!href || isExternalResource(href)) return;
      const cssPath = resolveResourcePath(href);
      if (!cssPath) return;

      try {
        const cssBlob = await this.loadResource(cssPath);
        if (!cssBlob) return;
        const cssText = await cssBlob.text();
        const style = doc.createElement('style');
        style.setAttribute('data-epub-css-path', cssPath);
        style.setAttribute(
          'data-epub-css-base',
          cssPath.substring(0, cssPath.lastIndexOf('/') + 1)
	        );
	        style.textContent = cssText;
	        doc.body.prepend(style);
	        link.remove();
	      } catch (error) {
	        console.warn('⚠️ 内联 EPUB 样式失败:', href, error);
	      }
    };

    // 处理图片路径
    const images = doc.querySelectorAll('img');
    images.forEach((img) => {
      markSrc(img, 'src', 'data-epub-src');
      const legacyPath = img.getAttribute('data-epub-src');
      if (legacyPath) {
        img.setAttribute('data-full-path', legacyPath);
      }
      markSrcset(img);
    });

	    doc.querySelectorAll('source').forEach((source) => {
	      markSrc(source, 'src', 'data-epub-src');
	      markSrcset(source);
	    });

	    doc.querySelectorAll('track, embed, iframe').forEach((element) => {
	      markSrc(element, 'src', 'data-epub-src');
	    });

	    doc.querySelectorAll('object').forEach((object) => {
	      markSrc(object, 'data', 'data-epub-data');
	    });

    doc.querySelectorAll('audio, video').forEach((media) => {
      markSrc(media, 'src', 'data-epub-src');
      markSrc(media, 'poster', 'data-epub-poster');
      media.setAttribute('controls', media.getAttribute('controls') ?? '');
      media.setAttribute('preload', media.getAttribute('preload') ?? 'metadata');
    });

    doc.querySelectorAll('image').forEach((image) => {
      const href = image.getAttribute('href') || image.getAttribute('xlink:href');
      if (!href || isExternalResource(href)) return;
      const fullPath = resolveResourcePath(href);
      if (!fullPath) return;
      image.setAttribute('data-original-href', href);
      image.setAttribute('data-epub-href', fullPath);
      image.removeAttribute('href');
      image.removeAttribute('xlink:href');
    });

    doc.querySelectorAll<HTMLElement>('[style]').forEach((element) => {
      markInlineStyle(element);
    });

    doc.querySelectorAll('style').forEach((style) => {
      if (!style.getAttribute('data-epub-css-base')) {
        style.setAttribute('data-epub-css-base', chapterDir);
      }
    });

    const stylesheetLinks = Array.from(
      doc.querySelectorAll<HTMLLinkElement>('link[rel~="stylesheet"][href]')
    );
    await Promise.all(stylesheetLinks.map((link) => inlineStylesheet(link)));

    doc.querySelectorAll('a[href^="#"], a[epub\\:type~="noteref"], a[type~="noteref"]').forEach((link) => {
      link.setAttribute('data-epub-footnote-ref', 'true');
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
    if (!entry || !this.isFileEntry(entry)) {
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
    // 过滤掉标题为空的章节（识别不到章节名字的）
    return this.chapters.filter(ch => ch.title && ch.title.trim().length > 0);
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
    
    try {
      // 检查封面文件是否存在
      const coverPath = this.normalizePath(this.metadata.cover);
      const coverEntry = this.entries.find(
        (entry) => entry.filename === coverPath
      );
      
      if (!coverEntry || !this.isFileEntry(coverEntry)) {
        console.warn('⚠️ 封面文件不存在:', coverPath);
        return null;
      }
      
      return await this.loadResource(coverPath);
    } catch (error) {
      console.warn('⚠️ 加载封面失败:', error);
      return null;
    }
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
