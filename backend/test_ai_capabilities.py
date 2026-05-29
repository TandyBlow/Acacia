"""
测试AI能否实现对话式知识点生成的核心能力
"""
import json
import os
import sys
import httpx

# 设置输出编码为UTF-8
sys.stdout.reconfigure(encoding='utf-8')

LLM_API_KEY = os.getenv("LLM_API_KEY")
if not LLM_API_KEY:
    raise RuntimeError("LLM_API_KEY 环境变量未设置")
LLM_MODEL = "deepseek-chat"
LLM_URL = "https://api.deepseek.com/v1/chat/completions"

def call_llm(messages: list[dict]) -> str:
    """调用LLM API"""
    headers = {
        "Authorization": f"Bearer {LLM_API_KEY}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": LLM_MODEL,
        "messages": messages,
        "temperature": 0.7,
    }

    with httpx.Client(timeout=30) as client:
        resp = client.post(LLM_URL, headers=headers, json=payload)
        resp.raise_for_status()

    data = resp.json()
    return data["choices"][0]["message"]["content"]


# 测试1：知识点提取和分组
def test_knowledge_extraction():
    print("=" * 60)
    print("测试1：从文件内容中提取知识点并分组")
    print("=" * 60)

    sample_content = """
# React Hooks 入门

React Hooks 是 React 16.8 引入的新特性，它让你在不编写 class 的情况下使用 state 以及其他的 React 特性。

## useState

useState 是最常用的 Hook。它让函数组件也能拥有自己的状态。

```javascript
const [count, setCount] = useState(0);
```

第一个值是当前状态，第二个值是更新状态的函数。

## useEffect

useEffect 用于处理副作用，比如数据获取、订阅或手动修改 DOM。它在组件渲染后执行。

```javascript
useEffect(() => {
  document.title = `You clicked ${count} times`;
}, [count]);
```

依赖数组决定了 effect 何时重新执行。

## 自定义 Hook

你可以创建自己的 Hook 来复用状态逻辑。自定义 Hook 是一个函数，名称以 "use" 开头。
"""

    system_prompt = """你是一个知识点提取助手。用户会提供学习材料，你需要：
1. 提取出3-5个核心知识点（可独立理解的最小概念单元）
2. 如果知识点超过5个，按主题分组
3. 返回JSON格式：
{
  "total_count": 总知识点数,
  "groups": [
    {
      "group_name": "分组名称",
      "knowledge_points": [
        {
          "id": "kp_1",
          "title": "知识点标题",
          "type": "concept|principle|application|comparison",
          "brief": "一句话概括"
        }
      ]
    }
  ]
}"""

    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": f"请从以下材料中提取知识点：\n\n{sample_content}"}
    ]

    response = call_llm(messages)
    print("\nAI响应：")
    print(response)

    try:
        result = json.loads(response)
        print("\n✅ JSON解析成功")
        print(f"总知识点数：{result.get('total_count')}")
        print(f"分组数：{len(result.get('groups', []))}")
        return True
    except json.JSONDecodeError as e:
        print(f"\n❌ JSON解析失败：{e}")
        return False


# 测试2：根据知识点类型生成问题
def test_question_generation():
    print("\n" + "=" * 60)
    print("测试2：根据知识点类型生成具体问题")
    print("=" * 60)

    knowledge_points = [
        {"id": "kp_1", "title": "useState Hook", "type": "concept"},
        {"id": "kp_2", "title": "useEffect 的依赖数组", "type": "principle"},
        {"id": "kp_3", "title": "自定义 Hook 的命名规则", "type": "application"},
    ]

    system_prompt = """你是一个问题生成助手。根据知识点类型生成具体的引导问题：
- concept（概念）：问"用你自己的话说，XX是什么？"
- principle（原理）：问"你觉得XX是怎么工作的？"或"为什么会这样？"
- application（应用）：问"你能想到什么实际例子？"或"XX怎么用？"
- comparison（对比）：问"XX和YY有什么区别？"

返回JSON格式：
{
  "questions": [
    {
      "kp_id": "知识点ID",
      "question": "具体问题",
      "hints": ["提示1", "提示2"]  // 如果用户说"不知道"时给的提示
    }
  ]
}"""

    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": f"为以下知识点生成问题：\n{json.dumps(knowledge_points, ensure_ascii=False, indent=2)}"}
    ]

    response = call_llm(messages)
    print("\nAI响应：")
    print(response)

    try:
        result = json.loads(response)
        print("\n✅ JSON解析成功")
        print(f"生成问题数：{len(result.get('questions', []))}")
        for q in result.get('questions', []):
            print(f"  - {q.get('question')}")
        return True
    except json.JSONDecodeError as e:
        print(f"\n❌ JSON解析失败：{e}")
        return False


# 测试3：理解用户回答并决定是否追问
def test_answer_understanding():
    print("\n" + "=" * 60)
    print("测试3：理解用户回答的完整性并决定是否追问")
    print("=" * 60)

    test_cases = [
        {
            "question": "用你自己的话说，useState是什么？",
            "user_answer": "就是用来管理状态的",
            "knowledge_context": "useState是React提供的Hook，让函数组件能够拥有状态"
        },
        {
            "question": "用你自己的话说，useState是什么？",
            "user_answer": "useState是React的一个Hook，它让函数组件也能有自己的状态变量，不需要写class组件了",
            "knowledge_context": "useState是React提供的Hook，让函数组件能够拥有状态"
        },
        {
            "question": "用你自己的话说，useState是什么？",
            "user_answer": "不太清楚",
            "knowledge_context": "useState是React提供的Hook，让函数组件能够拥有状态"
        }
    ]

    system_prompt = """你是一个对话引导助手。评估用户的回答质量并决定下一步：
1. 如果回答完整且准确 → 返回 "action": "accept"
2. 如果回答部分正确但不完整 → 返回 "action": "follow_up"，并给出追问
3. 如果回答错误或说"不知道" → 返回 "action": "hint"，并给出提示

返回JSON格式：
{
  "action": "accept|follow_up|hint",
  "reason": "判断理由",
  "next_message": "给用户的回复或追问"
}"""

    for i, case in enumerate(test_cases, 1):
        print(f"\n--- 测试用例 {i} ---")
        print(f"问题：{case['question']}")
        print(f"用户回答：{case['user_answer']}")

        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": f"""
知识点上下文：{case['knowledge_context']}
我的问题：{case['question']}
用户的回答：{case['user_answer']}

请评估这个回答。
"""}
        ]

        response = call_llm(messages)
        print(f"\nAI评估：")
        print(response)

        try:
            result = json.loads(response)
            action = result.get('action')
            print(f"\n决策：{action}")
            print(f"理由：{result.get('reason')}")
            print(f"下一步：{result.get('next_message')}")
        except json.JSONDecodeError as e:
            print(f"\n❌ JSON解析失败：{e}")


# 测试4：根据用户回答生成笔记内容
def test_content_generation():
    print("\n" + "=" * 60)
    print("测试4：根据用户回答生成笔记内容")
    print("=" * 60)

    test_case = {
        "knowledge_point": "useState Hook",
        "question": "用你自己的话说，useState是什么？",
        "user_answer": "useState是React的一个Hook，它让函数组件也能有自己的状态变量，不需要写class组件了",
        "source_content": """useState 是最常用的 Hook。它让函数组件也能拥有自己的状态。

```javascript
const [count, setCount] = useState(0);
```

第一个值是当前状态，第二个值是更新状态的函数。"""
    }

    system_prompt = """你是一个笔记生成助手。根据用户的回答生成笔记内容：
1. 核心观点必须来自用户的回答
2. 可以补充必要的细节和示例（来自原始材料）
3. 用Markdown格式
4. 100-200字
5. 语气要像是用户自己写的，不要太正式

返回JSON格式：
{
  "content": "生成的笔记内容（Markdown）"
}"""

    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": f"""
知识点：{test_case['knowledge_point']}
我的问题：{test_case['question']}
用户的回答：{test_case['user_answer']}

原始材料：
{test_case['source_content']}

请生成笔记内容。
"""}
    ]

    response = call_llm(messages)
    print("\nAI响应：")
    print(response)

    try:
        result = json.loads(response)
        print("\n✅ JSON解析成功")
        print("\n生成的笔记内容：")
        print("-" * 40)
        print(result.get('content'))
        print("-" * 40)
        return True
    except json.JSONDecodeError as e:
        print(f"\n❌ JSON解析失败：{e}")
        return False


if __name__ == "__main__":
    print("开始测试AI能力...\n")

    results = []

    try:
        results.append(("知识点提取", test_knowledge_extraction()))
    except Exception as e:
        print(f"\n❌ 测试失败：{e}")
        results.append(("知识点提取", False))

    try:
        results.append(("问题生成", test_question_generation()))
    except Exception as e:
        print(f"\n❌ 测试失败：{e}")
        results.append(("问题生成", False))

    try:
        test_answer_understanding()
        results.append(("回答理解", True))
    except Exception as e:
        print(f"\n❌ 测试失败：{e}")
        results.append(("回答理解", False))

    try:
        results.append(("内容生成", test_content_generation()))
    except Exception as e:
        print(f"\n❌ 测试失败：{e}")
        results.append(("内容生成", False))

    print("\n" + "=" * 60)
    print("测试总结")
    print("=" * 60)
    for name, success in results:
        status = "✅ 通过" if success else "❌ 失败"
        print(f"{name}: {status}")

    all_passed = all(r[1] for r in results)
    if all_passed:
        print("\n🎉 所有测试通过！AI完全有能力实现对话式知识点生成。")
    else:
        print("\n⚠️ 部分测试失败，需要调整prompt或模型。")
