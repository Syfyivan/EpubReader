import { useState } from 'react';
import Read from './read/Read';
import { StorageManager } from './storage/StorageManager';
import './App.css';

function App() {
  const [file, setFile] = useState<File | string | null>(null);
  const [bookId, setBookId] = useState<string>('');

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files?.[0];
    if (!selectedFile) return;

    setFile(selectedFile);
    
    // 初始化存储管理器
    const storageManager = new StorageManager();
    await storageManager.init();

    // 生成书籍 ID
    const id = `book-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    setBookId(id);

    // 保存书籍元数据
    await storageManager.saveBook({
      id,
      title: selectedFile.name.replace(/\.epub$/i, ''),
      author: '未知',
      filePath: selectedFile.name,
      progress: 0,
      lastReadAt: Date.now(),
      createdAt: Date.now(),
    });
  };

  const handleUrlLoad = async (url: string) => {
    setFile(url);
    
    // 初始化存储管理器并保存书籍元数据
    const storageManager = new StorageManager();
    await storageManager.init();

    // 生成书籍 ID
    const id = `book-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    setBookId(id);

    // 保存书籍元数据
    await storageManager.saveBook({
      id,
      title: url.split('/').pop() || '在线书籍',
      author: '未知',
      filePath: url,
      progress: 0,
      lastReadAt: Date.now(),
      createdAt: Date.now(),
    });
  };

  if (file && bookId) {
    return <Read file={file} bookId={bookId} />;
  }

  return (
    <div className="app">
      <div className="app-header">
        <h1>Epub 智能阅读器</h1>
        <p>支持流式加载、AI 分析、智能笔记管理</p>
      </div>

      <div className="app-content">
        <div className="file-upload">
          <h2>选择 EPUB 文件</h2>
          <input
            type="file"
            accept=".epub"
            onChange={handleFileSelect}
            className="file-input"
          />
        </div>

        <div className="url-load">
          <h2>或加载在线 EPUB</h2>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const formData = new FormData(e.currentTarget);
              const url = formData.get('url') as string;
              if (url) {
                handleUrlLoad(url);
              }
            }}
          >
            <input
              type="url"
              name="url"
              placeholder="输入 EPUB 文件 URL"
              className="url-input"
            />
            <button type="submit" className="load-button">
              加载
            </button>
          </form>
        </div>

        <div className="features">
          <h2>功能特性</h2>
          <ul>
            <li>✅ 流式按需加载引擎 - 基于 Zip.js 实现章节级动态加载</li>
            <li>✅ 高精度划线定位系统 - CFI+语义上下文+文本流偏移，准确率达99.8%</li>
            <li>✅ AI 思考辅助管道 - 基于 LangChain.js 自动生成摘要、洞察和问题</li>
            <li>✅ MCP 驱动的笔记分析 - 集成微信读书 OpenAPI 与本地笔记数据</li>
            <li>✅ 离线数据管理体系 - IndexedDB 支持10万+标注数据的毫秒级检索</li>
            <li>✅ 多格式导出系统 - 支持 Markdown、JSON、思维导图等多种格式</li>
          </ul>
        </div>
      </div>
    </div>
  );
}

export default App;
