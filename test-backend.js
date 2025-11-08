/**
 * 后端 API 测试脚本
 * 运行方式: node test-backend.js
 */

const API_BASE_URL = "http://localhost:3001";

async function testAnalyzeAPI() {
  console.log("🧪 测试 1: AI 内容分析 API");
  console.log("=".repeat(50));

  try {
    const response = await fetch(`${API_BASE_URL}/api/ai/analyze`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        content:
          "人工智能（Artificial Intelligence，AI）是计算机科学的一个分支，它企图了解智能的实质，并生产出一种新的能以人类智能相似的方式做出反应的智能机器。该领域的研究包括机器人、语言识别、图像识别、自然语言处理和专家系统等。",
      }),
    });

    if (response.ok) {
      const data = await response.json();
      console.log("✅ 测试通过！");
      console.log("\n📝 摘要:", data.summary);
      console.log("\n💡 洞察 (前3个):");
      data.insights.slice(0, 3).forEach((insight, i) => {
        console.log(`   ${i + 1}. ${insight}`);
      });
      console.log("\n❓ 问题 (前3个):");
      data.questions.slice(0, 3).forEach((question, i) => {
        console.log(`   ${i + 1}. ${question}`);
      });
      console.log("\n🔗 知识关联 (前2个):");
      data.connections.slice(0, 2).forEach((conn, i) => {
        console.log(`   ${i + 1}. ${conn}`);
      });
      return true;
    } else {
      console.error("❌ 测试失败:", response.status, response.statusText);
      return false;
    }
  } catch (error) {
    console.error("❌ 请求错误:", error.message);
    console.log("\n💡 提示: 请确保后端服务已启动 (npm run backend)");
    return false;
  }
}

async function testCodeGenerateAPI() {
  console.log("\n\n🧪 测试 2: 代码生成 API");
  console.log("=".repeat(50));

  try {
    const response = await fetch(`${API_BASE_URL}/api/ai/code/generate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        description: "实现一个简单的斐波那契数列函数",
        language: "typescript",
      }),
    });

    if (response.ok) {
      const data = await response.json();
      console.log("✅ 测试通过！");
      console.log("\n💻 生成的代码:");
      console.log(data.code.substring(0, 200) + "...");
      return true;
    } else {
      console.error("❌ 测试失败:", response.status, response.statusText);
      return false;
    }
  } catch (error) {
    console.error("❌ 请求错误:", error.message);
    return false;
  }
}

async function testHealthCheck() {
  console.log("🏥 健康检查: 测试后端服务连接");
  console.log("=".repeat(50));

  try {
    const response = await fetch(`${API_BASE_URL}/api/ai/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "测试" }),
    });

    if (response.ok || response.status === 400) {
      console.log("✅ 后端服务运行正常\n");
      return true;
    } else {
      console.log("⚠️ 后端响应异常:", response.status, "\n");
      return false;
    }
  } catch (error) {
    console.log("❌ 无法连接到后端服务");
    console.log("   错误:", error.message);
    console.log("\n💡 解决方法:");
    console.log("   1. 打开新终端窗口");
    console.log("   2. 运行: npm run backend");
    console.log("   3. 等待服务启动完成");
    console.log("   4. 再次运行此测试脚本\n");
    return false;
  }
}

async function runAllTests() {
  console.log("\n🚀 开始测试 EPUB Reader 后端 API");
  console.log("=".repeat(50));
  console.log(`API 地址: ${API_BASE_URL}\n`);

  // 健康检查
  const isHealthy = await testHealthCheck();
  if (!isHealthy) {
    console.log("\n⛔ 测试终止: 后端服务未启动");
    process.exit(1);
  }

  // 运行测试
  const results = [];

  results.push(await testAnalyzeAPI());
  results.push(await testCodeGenerateAPI());

  // 总结
  console.log("\n\n📊 测试总结");
  console.log("=".repeat(50));
  const passed = results.filter((r) => r).length;
  const total = results.length;
  console.log(`通过: ${passed}/${total}`);

  if (passed === total) {
    console.log("🎉 所有测试通过！后端 API 工作正常！\n");
  } else {
    console.log("⚠️ 部分测试失败，请检查错误信息\n");
  }
}

// 运行测试
runAllTests().catch(console.error);
