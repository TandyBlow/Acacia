# Procedure Knowledge Point Example Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add procedure-type knowledge points with LaTeX example generation and multi-round confirmation to the conversation-based knowledge point system.

**Architecture:** Extend backend conversation flow to detect procedure-type knowledge points, generate LaTeX examples via DeepSeek API, and provide a confirmation loop. Frontend adds example preview UI with accept/regenerate/skip actions.

**Tech Stack:** Python (FastAPI, httpx), TypeScript (Vue 3, Pinia), KaTeX (already integrated)

---

## File Structure

**Backend (Python):**
- Modify: `backend/file_knowledge_service.py` — Add procedure type, example generation function, feedback processing
- Modify: `backend/main.py` — Add `/example-feedback` endpoint and request model

**Frontend (TypeScript/Vue):**
- Modify: `frontend/src/composables/useFileGenerate.ts` — Add `sendExampleFeedback()` method, extend type
- Modify: `frontend/src/components/ai/ConversationView.vue` — Add example preview UI and feedback handling
- Modify: `frontend/src/components/ai/FileGenerateDialog.vue` — Handle example feedback events

---

## Task 1: Extend Knowledge Point Type (Backend)

**Files:**
- Modify: `backend/file_knowledge_service.py:23-51`

- [ ] **Step 1: Update KNOWLEDGE_EXTRACTION_PROMPT to include procedure type**

```python
# Knowledge extraction prompt
KNOWLEDGE_EXTRACTION_PROMPT = """你是一个知识点提取助手。用户会提供学习材料，你需要：
1. 提取出3-15个核心知识点（可独立理解的最小概念单元）
2. 为每个知识点分类：concept（概念）、principle（原理）、application（应用）、comparison（对比）、procedure（步骤方法）
3. 如果知识点超过10个，按主题分组
4. 返回JSON格式：
{
  "total_count": 总知识点数,
  "groups": [
    {
      "group_name": "分组名称",
      "knowledge_points": [
        {
          "id": "kp_1",
          "title": "知识点标题",
          "type": "concept|principle|application|comparison|procedure",
          "brief": "一句话概括",
          "source_content": "原文相关内容（可选，用于后续生成问题）"
        }
      ]
    }
  ]
}

注意：
- 知识点标题要简洁（不超过20字）
- brief要能让人快速理解这个知识点是什么
- 如果知识点≤10个，所有知识点放在一个分组中，group_name为"全部"
- 如果知识点>10个，按主题合理分组（每组3-5个知识点）
- procedure类型用于需要计算步骤示例的方法（如牛顿法、积分技巧、矩阵运算等）
"""
```

- [ ] **Step 2: Update QUESTION_GENERATION_PROMPT to handle procedure type**

```python
# Question generation prompt template
QUESTION_GENERATION_PROMPT = """你是一个问题生成助手。根据知识点类型生成具体的引导问题：
- concept（概念）：问"用你自己的话说，XX是什么？"
- principle（原理）：问"你觉得XX是怎么工作的？"或"为什么会这样？"
- application（应用）：问"你能想到什么实际例子？"或"XX怎么用？"
- comparison（对比）：问"XX和YY有什么区别？"
- procedure（步骤方法）：问"你觉得XX的核心思路是什么？"或"XX的关键步骤是什么？"

返回JSON格式：
{
  "question": "具体问题",
  "hints": ["提示1", "提示2"]
}

提示用于用户回答"不知道"时给出引导。
"""
```

- [ ] **Step 3: Commit type extension**

```bash
cd D:\others\Acacia
git add backend/file_knowledge_service.py
git commit -m "feat: add procedure type to knowledge point extraction"
```

---

## Task 2: Add Example Generation Function (Backend)

**Files:**
- Modify: `backend/file_knowledge_service.py:100` (after CONTENT_GENERATION_PROMPT)

- [ ] **Step 1: Add EXAMPLE_GENERATION_PROMPT constant**

```python
# Example generation prompt template for procedure-type knowledge points
EXAMPLE_GENERATION_PROMPT = """你是一个数学例题生成助手。根据用户对方法的理解，生成一个完整的计算例题。

要求：
1. 例题必须体现用户理解的核心思路
2. 使用 LaTeX 格式（行内公式 $...$，块级公式 $$...$$）
3. 包含：问题描述 + 完整的分步骤解答
4. 每个步骤要有说明文字
5. 100-300字

返回JSON格式：
{
  "example_content": "Markdown格式的例题内容（包含LaTeX）",
  "explanation": "为什么这个例题能说明用户的理解"
}

注意：
- 例题要具体，不要太抽象
- 步骤要清晰，每步都有说明
- LaTeX 语法要正确
"""
```

- [ ] **Step 2: Add generate_example_for_procedure function**

```python
def generate_example_for_procedure(
    kp: Dict[str, Any],
    user_answer: str,
    conversation_history: List[Dict[str, str]],
    previous_example: str | None = None,
    user_feedback: str | None = None
) -> Dict[str, Any]:
    """
    Generate a calculation example for procedure-type knowledge point.

    Args:
        kp: Knowledge point dictionary
        user_answer: User's final answer explaining their understanding
        conversation_history: Full conversation for this knowledge point
        previous_example: Previous generated example (for regeneration)
        user_feedback: User's feedback on previous example (for regeneration)

    Returns:
        Dictionary with example_content and explanation
    """
    # Build conversation context
    conversation_text = "\n".join([
        f"{msg['role']}: {msg['content']}"
        for msg in conversation_history
    ])

    # Build prompt
    prompt_parts = [
        f"知识点：{kp['title']}",
        f"类型：{kp['type']}",
        f"简介：{kp['brief']}",
        "",
        "对话历史：",
        conversation_text,
        "",
        f"用户的理解：{user_answer}",
    ]

    if kp.get('source_content'):
        prompt_parts.extend([
            "",
            "原始材料片段：",
            kp['source_content']
        ])

    # Add regeneration context if provided
    if previous_example and user_feedback:
        prompt_parts.extend([
            "",
            "之前生成的例题：",
            previous_example,
            "",
            "用户的反馈：",
            user_feedback,
            "",
            "请根据反馈重新生成一个不同的例题。"
        ])

    user_content = "\n".join(prompt_parts)

    messages = [
        {"role": "system", "content": EXAMPLE_GENERATION_PROMPT},
        {"role": "user", "content": user_content}
    ]

    raw_response = call_deepseek(messages)
    result = parse_json_response(raw_response)

    # Validate response structure
    if "example_content" not in result:
        raise ValueError("Invalid example generation response: missing example_content")

    return result
```

- [ ] **Step 3: Commit example generation function**

```bash
git add backend/file_knowledge_service.py
git commit -m "feat: add example generation function for procedure knowledge points"
```

---

## Task 3: Modify Conversation Flow for Procedure Type (Backend)

**Files:**
- Modify: `backend/file_knowledge_service.py:407-612` (process_conversation_turn function)

- [ ] **Step 1: Update session initialization to include example fields**

Find the `create_conversation_session` function (around line 306) and update the session dict:

```python
_conversation_sessions[session_id] = {
    "session_id": session_id,
    "node_id": node_id,
    "owner_id": owner_id,
    "file_id": file_id,
    "knowledge_points": knowledge_points,
    "current_index": 0,
    "messages": [],
    "generated_content": "",
    "status": "active",
    "created_at": time.time(),
    "last_activity_at": time.time(),
    "follow_up_count": 0,
    "pending_example": None,  # NEW: Store pending example for confirmation
    "example_history": [],    # NEW: Track previous examples
}
```

- [ ] **Step 2: Modify process_conversation_turn to handle procedure type**

In the `process_conversation_turn` function, find the section where `action == "accept"` (around line 510). Replace the content generation logic with:

```python
# Handle different actions
if action == "accept":
    # Check if this is a procedure-type knowledge point
    if current_kp["type"] == "procedure":
        # Generate example instead of final content
        try:
            example_data = generate_example_for_procedure(
                current_kp,
                user_answer,
                kp_messages
            )
            
            # Store pending example in session
            session["pending_example"] = {
                "example_content": example_data["example_content"],
                "explanation": example_data.get("explanation", ""),
                "generation_count": 1
            }
            
            return {
                "action": "example_preview",
                "ai_message": "我根据你的理解生成了一个例题，看看是否符合你的想法？",
                "example_content": example_data["example_content"],
                "example_explanation": example_data.get("explanation", ""),
                "progress": {
                    "current": session["current_index"],
                    "total": len(knowledge_points),
                    "kp_title": current_kp["title"],
                    "kp_type": current_kp["type"],
                }
            }
        except Exception as e:
            # If example generation fails, fall back to text-only content
            print(f"Example generation failed: {e}")
            # Continue with normal content generation below
    
    # Generate content from conversation (for non-procedure or failed procedure)
    kp_messages = [
        msg for msg in session["messages"]
        if msg.get("metadata", {}).get("kp_id") == current_kp["id"] or
           (msg["role"] == "user" and session["messages"].index(msg) >
            next((i for i, m in enumerate(session["messages"])
                  if m.get("metadata", {}).get("kp_id") == current_kp["id"]), 0))
    ]

    generated_content = generate_content_from_answer(
        current_kp,
        last_question or "",
        user_answer,
        kp_messages
    )

    # Append to accumulated content
    if session["generated_content"]:
        session["generated_content"] += "\n\n---\n\n"
    session["generated_content"] += f"## {current_kp['title']}\n\n{generated_content}"

    # Move to next knowledge point
    session["current_index"] += 1
    session["follow_up_count"] = 0

    # Check if all completed
    if session["current_index"] >= len(knowledge_points):
        session["status"] = "completed"
        return {
            "action": "completed",
            "ai_message": ai_message,
            "generated_content": generated_content,
            "total_content": session["generated_content"],
            "progress": {
                "current": session["current_index"],
                "total": len(knowledge_points),
                "completed": True
            }
        }

    # Generate question for next knowledge point
    next_kp = knowledge_points[session["current_index"]]
    question_data = generate_question_for_knowledge_point(next_kp)

    session["messages"].append({
        "role": "ai",
        "content": question_data["question"],
        "timestamp": time.time(),
        "metadata": {
            "kp_id": next_kp["id"],
            "hints": question_data.get("hints", [])
        }
    })

    return {
        "action": "accept_and_next",
        "ai_message": ai_message,
        "generated_content": generated_content,
        "next_question": question_data["question"],
        "hints": question_data.get("hints", []),
        "progress": {
            "current": session["current_index"],
            "total": len(knowledge_points),
            "kp_title": next_kp["title"],
            "kp_type": next_kp["type"],
        }
    }
```

- [ ] **Step 3: Commit conversation flow modification**

```bash
git add backend/file_knowledge_service.py
git commit -m "feat: modify conversation flow to generate examples for procedure type"
```

---

## Task 4: Add Example Feedback Processing Function (Backend)

**Files:**
- Modify: `backend/file_knowledge_service.py:627` (after cleanup_old_sessions)

- [ ] **Step 1: Add process_example_feedback function**

```python
def process_example_feedback(
    session_id: str,
    action: str,
    feedback: str | None = None
) -> Dict[str, Any]:
    """
    Process user feedback on generated example.

    Args:
        session_id: Conversation session ID
        action: "accept" | "regenerate" | "skip"
        feedback: User's feedback text (required for regenerate)

    Returns:
        Dictionary with action and next step info
    """
    session = get_conversation_session(session_id)
    
    current_index = session["current_index"]
    knowledge_points = session["knowledge_points"]
    current_kp = knowledge_points[current_index]
    
    pending_example = session.get("pending_example")
    if not pending_example:
        raise ValueError("No pending example found")
    
    if action == "accept":
        # Generate final content with example
        example_content = pending_example["example_content"]
        
        # Find user's answer from conversation history
        user_answer = ""
        for msg in reversed(session["messages"]):
            if msg["role"] == "user":
                user_answer = msg["content"]
                break
        
        # Combine user understanding with example
        final_content = f"{user_answer}\n\n{example_content}"
        
        # Append to accumulated content
        if session["generated_content"]:
            session["generated_content"] += "\n\n---\n\n"
        session["generated_content"] += f"## {current_kp['title']}\n\n{final_content}"
        
        # Store in example history
        session["example_history"].append({
            "kp_id": current_kp["id"],
            "example": example_content,
            "accepted": True
        })
        
        # Clear pending example
        session["pending_example"] = None
        
        # Move to next knowledge point
        session["current_index"] += 1
        session["follow_up_count"] = 0
        
        # Check if all completed
        if session["current_index"] >= len(knowledge_points):
            session["status"] = "completed"
            return {
                "action": "completed",
                "ai_message": "所有知识点已完成！",
                "generated_content": final_content,
                "total_content": session["generated_content"],
                "progress": {
                    "current": session["current_index"],
                    "total": len(knowledge_points),
                    "completed": True
                }
            }
        
        # Generate question for next knowledge point
        next_kp = knowledge_points[session["current_index"]]
        question_data = generate_question_for_knowledge_point(next_kp)
        
        session["messages"].append({
            "role": "ai",
            "content": question_data["question"],
            "timestamp": time.time(),
            "metadata": {
                "kp_id": next_kp["id"],
                "hints": question_data.get("hints", [])
            }
        })
        
        return {
            "action": "next_question",
            "ai_message": "很好！让我们继续下一个知识点。",
            "generated_content": final_content,
            "next_question": question_data["question"],
            "hints": question_data.get("hints", []),
            "progress": {
                "current": session["current_index"],
                "total": len(knowledge_points),
                "kp_title": next_kp["title"],
                "kp_type": next_kp["type"],
            }
        }
    
    elif action == "regenerate":
        if not feedback:
            raise ValueError("Feedback is required for regenerate action")
        
        # Check regeneration limit
        generation_count = pending_example.get("generation_count", 1)
        if generation_count >= 3:
            return {
                "action": "regeneration_limit",
                "ai_message": "已经重新生成3次了，建议选择接受当前例题或跳过。",
                "example_content": pending_example["example_content"],
                "example_explanation": pending_example.get("explanation", ""),
                "progress": {
                    "current": session["current_index"],
                    "total": len(knowledge_points),
                    "kp_title": current_kp["title"],
                    "kp_type": current_kp["type"],
                }
            }
        
        # Get conversation history for this knowledge point
        kp_messages = [
            msg for msg in session["messages"]
            if msg.get("metadata", {}).get("kp_id") == current_kp["id"] or
               (msg["role"] == "user" and session["messages"].index(msg) >
                next((i for i, m in enumerate(session["messages"])
                      if m.get("metadata", {}).get("kp_id") == current_kp["id"]), 0))
        ]
        
        # Find user's answer
        user_answer = ""
        for msg in reversed(kp_messages):
            if msg["role"] == "user":
                user_answer = msg["content"]
                break
        
        # Regenerate example with feedback
        try:
            new_example = generate_example_for_procedure(
                current_kp,
                user_answer,
                kp_messages,
                previous_example=pending_example["example_content"],
                user_feedback=feedback
            )
            
            # Update pending example
            session["pending_example"] = {
                "example_content": new_example["example_content"],
                "explanation": new_example.get("explanation", ""),
                "generation_count": generation_count + 1
            }
            
            # Store in example history
            session["example_history"].append({
                "kp_id": current_kp["id"],
                "example": pending_example["example_content"],
                "accepted": False,
                "feedback": feedback
            })
            
            return {
                "action": "example_preview",
                "ai_message": "我根据你的反馈重新生成了例题，看看这次是否更符合你的想法？",
                "example_content": new_example["example_content"],
                "example_explanation": new_example.get("explanation", ""),
                "progress": {
                    "current": session["current_index"],
                    "total": len(knowledge_points),
                    "kp_title": current_kp["title"],
                    "kp_type": current_kp["type"],
                }
            }
        except Exception as e:
            raise ValueError(f"例题重新生成失败：{str(e)}")
    
    elif action == "skip":
        # Generate text-only content without example
        kp_messages = [
            msg for msg in session["messages"]
            if msg.get("metadata", {}).get("kp_id") == current_kp["id"] or
               (msg["role"] == "user" and session["messages"].index(msg) >
                next((i for i, m in enumerate(session["messages"])
                      if m.get("metadata", {}).get("kp_id") == current_kp["id"]), 0))
        ]
        
        # Find user's answer and last question
        user_answer = ""
        last_question = ""
        for msg in reversed(kp_messages):
            if msg["role"] == "user" and not user_answer:
                user_answer = msg["content"]
            if msg["role"] == "ai" and msg.get("metadata", {}).get("kp_id") == current_kp["id"]:
                last_question = msg["content"]
                break
        
        # Generate text-only content
        generated_content = generate_content_from_answer(
            current_kp,
            last_question,
            user_answer,
            kp_messages
        )
        
        # Append to accumulated content
        if session["generated_content"]:
            session["generated_content"] += "\n\n---\n\n"
        session["generated_content"] += f"## {current_kp['title']}\n\n{generated_content}"
        
        # Store in example history
        session["example_history"].append({
            "kp_id": current_kp["id"],
            "example": pending_example["example_content"],
            "accepted": False,
            "skipped": True
        })
        
        # Clear pending example
        session["pending_example"] = None
        
        # Move to next knowledge point
        session["current_index"] += 1
        session["follow_up_count"] = 0
        
        # Check if all completed
        if session["current_index"] >= len(knowledge_points):
            session["status"] = "completed"
            return {
                "action": "completed",
                "ai_message": "所有知识点已完成！",
                "generated_content": generated_content,
                "total_content": session["generated_content"],
                "progress": {
                    "current": session["current_index"],
                    "total": len(knowledge_points),
                    "completed": True
                }
            }
        
        # Generate question for next knowledge point
        next_kp = knowledge_points[session["current_index"]]
        question_data = generate_question_for_knowledge_point(next_kp)
        
        session["messages"].append({
            "role": "ai",
            "content": question_data["question"],
            "timestamp": time.time(),
            "metadata": {
                "kp_id": next_kp["id"],
                "hints": question_data.get("hints", [])
            }
        })
        
        return {
            "action": "next_question",
            "ai_message": "好的，让我们继续下一个知识点。",
            "generated_content": generated_content,
            "next_question": question_data["question"],
            "hints": question_data.get("hints", []),
            "progress": {
                "current": session["current_index"],
                "total": len(knowledge_points),
                "kp_title": next_kp["title"],
                "kp_type": next_kp["type"],
            }
        }
    
    else:
        raise ValueError(f"Invalid action: {action}")
```

- [ ] **Step 2: Commit example feedback processing**

```bash
git add backend/file_knowledge_service.py
git commit -m "feat: add example feedback processing function"
```

---

## Task 5: Add API Endpoint for Example Feedback (Backend)

**Files:**
- Modify: `backend/main.py:614` (after ConversationTurnRequest)

- [ ] **Step 1: Add ExampleFeedbackRequest model**

```python
class ExampleFeedbackRequest(BaseModel):
    session_id: str
    action: str  # "accept" | "regenerate" | "skip"
    feedback: str | None = None
```

- [ ] **Step 2: Add /example-feedback endpoint**

```python
@app.post("/example-feedback")
def example_feedback_endpoint(
    request: ExampleFeedbackRequest,
    user: dict = Depends(get_current_user)
):
    """
    Process user feedback on generated example.
    Returns next action: next_question, example_preview, or completed.
    """
    from file_knowledge_service import process_example_feedback

    # Validate action
    if request.action not in ["accept", "regenerate", "skip"]:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Invalid action: {request.action}"
        )

    # Validate feedback for regenerate
    if request.action == "regenerate" and not request.feedback:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Feedback is required for regenerate action"
        )

    try:
        result = process_example_feedback(
            request.session_id,
            request.action,
            request.feedback
        )
        return result
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(e)
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"例题反馈处理失败：{str(e)}"
        )
```

- [ ] **Step 3: Run backend to verify no syntax errors**

```bash
cd D:\others\Acacia\backend
python -m py_compile main.py
```

Expected: No output (success)

- [ ] **Step 4: Commit API endpoint**

```bash
cd D:\others\Acacia
git add backend/main.py
git commit -m "feat: add example feedback API endpoint"
```

---

## Task 6: Extend Frontend Type Definitions

**Files:**
- Modify: `frontend/src/composables/useFileGenerate.ts:4-10`

- [ ] **Step 1: Update KnowledgePoint type to include procedure**

```typescript
export interface KnowledgePoint {
  id: string;
  title: string;
  type: 'concept' | 'principle' | 'application' | 'comparison' | 'procedure';
  brief: string;
  source_content?: string;
}
```

- [ ] **Step 2: Commit type extension**

```bash
cd D:\others\Acacia
git add frontend/src/composables/useFileGenerate.ts
git commit -m "feat: extend KnowledgePoint type to include procedure"
```

---

## Task 7: Add sendExampleFeedback Method (Frontend)

**Files:**
- Modify: `frontend/src/composables/useFileGenerate.ts:215` (after sendAnswer function)

- [ ] **Step 1: Add sendExampleFeedback function**

```typescript
async function sendExampleFeedback(
  action: 'accept' | 'regenerate' | 'skip',
  feedback?: string
): Promise<any> {
  if (!sessionId.value) {
    throw new Error('No active session');
  }

  isBusy.value = true;
  errorMessage.value = '';

  try {
    const token = localStorage.getItem('acacia_backend_token');
    const response = await fetch(`${backendUrl}/example-feedback`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({
        session_id: sessionId.value,
        action,
        feedback,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || '例题反馈处理失败');
    }

    const result = await response.json();

    // Update conversation state
    if (result.progress) {
      conversationState.value = {
        currentIndex: result.progress.current,
        total: result.progress.total,
        currentKpTitle: result.progress.kp_title,
        isCompleted: result.progress.completed || false,
      };
    }

    return result;
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '例题反馈处理失败';
    throw error;
  } finally {
    isBusy.value = false;
  }
}
```

- [ ] **Step 2: Export sendExampleFeedback in return statement**

Find the return statement (around line 251) and add `sendExampleFeedback`:

```typescript
return {
  isOpen,
  isBusy,
  errorMessage,
  uploadedFile,
  extractionResult,
  sessionId,
  conversationState,
  needsOutlineSelection,
  openDialog,
  closeDialog,
  extractKnowledgePoints,
  startConversation,
  sendAnswer,
  sendExampleFeedback,  // NEW
  handleFileUploaded,
  setEditor,
  insertGeneratedContent,
};
```

- [ ] **Step 3: Run type check**

```bash
cd D:\others\Acacia\frontend
npm run build
```

Expected: No type errors

- [ ] **Step 4: Commit sendExampleFeedback method**

```bash
cd D:\others\Acacia
git add frontend/src/composables/useFileGenerate.ts
git commit -m "feat: add sendExampleFeedback method to useFileGenerate"
```

---

## Task 8: Add Example Preview UI (Frontend) - Part 1

**Files:**
- Modify: `frontend/src/components/ai/ConversationView.vue`

- [ ] **Step 1: Add example preview state and props**

In the `<script setup>` section, after existing refs (around line 99):

```typescript
const isShowingExample = ref(false);
const currentExample = ref<{
  content: string;
  explanation: string;
} | null>(null);
const feedbackText = ref('');
const showFeedbackInput = ref(false);
```

- [ ] **Step 2: Add example preview methods (part 1)**

After the `addAiMessage` function (around line 148):

```typescript
function showExample(content: string, explanation: string) {
  currentExample.value = { content, explanation };
  isShowingExample.value = true;
  showFeedbackInput.value = false;
  feedbackText.value = '';
  
  nextTick(() => {
    scrollToBottom();
  });
}

function handleAcceptExample() {
  if (isThinking.value) return;
  isThinking.value = true;
  isShowingExample.value = false;
  emit('example-feedback', { action: 'accept' });
}
```

- [ ] **Step 3: Add example preview methods (part 2)**

```typescript
function handleRegenerateExample() {
  if (!feedbackText.value.trim()) {
    showFeedbackInput.value = true;
    return;
  }
  
  if (isThinking.value) return;
  isThinking.value = true;
  isShowingExample.value = false;
  emit('example-feedback', { action: 'regenerate', feedback: feedbackText.value.trim() });
  feedbackText.value = '';
  showFeedbackInput.value = false;
}

function handleSkipExample() {
  if (isThinking.value) return;
  isThinking.value = true;
  isShowingExample.value = false;
  emit('example-feedback', { action: 'skip' });
}
```

- [ ] **Step 4: Update defineEmits to include example-feedback**

Find the `defineEmits` line (around line 92) and update:

```typescript
const emit = defineEmits<{
  answer: [answer: string];
  skip: [];
  'example-feedback': [payload: { action: string; feedback?: string }];
}>();
```

- [ ] **Step 5: Expose showExample method**

Find the `defineExpose` line (around line 162) and update:

```typescript
defineExpose({
  addAiMessage,
  showExample,
});
```

- [ ] **Step 6: Commit script changes**

```bash
cd D:\others\Acacia
git add frontend/src/components/ai/ConversationView.vue
git commit -m "feat: add example preview logic to ConversationView"
```

---

## Task 9: Add Example Preview UI (Frontend) - Part 2

**Files:**
- Modify: `frontend/src/components/ai/ConversationView.vue`

- [ ] **Step 1: Add renderMarkdown helper function**

In the `<script setup>` section, add this helper (can go after imports):

```typescript
function renderMarkdown(content: string): string {
  // Simple markdown to HTML conversion for preview
  // Note: KaTeX rendering will happen automatically via TipTap's Mathematics extension
  return content
    .replace(/\n/g, '<br>')
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>');
}
```

- [ ] **Step 2: Add example preview UI in template**

In the `<template>` section, after the messages container and before the input area (around line 40):

```vue
<!-- Example preview -->
<div v-if="isShowingExample && currentExample" class="example-preview">
  <div class="example-header">
    <div class="example-icon">📝</div>
    <div class="example-title">生成的例题</div>
  </div>
  
  <div class="example-content" v-html="renderMarkdown(currentExample.content)"></div>
  
  <div v-if="currentExample.explanation" class="example-explanation">
    <div class="explanation-label">说明：</div>
    <div class="explanation-text">{{ currentExample.explanation }}</div>
  </div>
  
  <div v-if="showFeedbackInput" class="feedback-input-area">
    <textarea
      v-model="feedbackText"
      class="feedback-textarea"
      placeholder="请说明你希望如何调整这个例题..."
      rows="3"
      :disabled="isThinking"
    />
  </div>
  
  <div class="example-actions">
    <button
      class="example-btn example-btn-skip"
      :disabled="isThinking"
      @click="handleSkipExample"
    >
      ⏭️ 跳过例题
    </button>
    <button
      class="example-btn example-btn-regenerate"
      :disabled="isThinking"
      @click="handleRegenerateExample"
    >
      🔄 {{ showFeedbackInput ? '提交反馈' : '重新生成' }}
    </button>
    <button
      class="example-btn example-btn-accept"
      :disabled="isThinking"
      @click="handleAcceptExample"
    >
      ✅ 符合我的理解
    </button>
  </div>
</div>
```

- [ ] **Step 3: Commit template changes**

```bash
cd D:\others\Acacia
git add frontend/src/components/ai/ConversationView.vue
git commit -m "feat: add example preview template to ConversationView"
```

---

## Task 10: Add Example Preview Styles (Frontend)

**Files:**
- Modify: `frontend/src/components/ai/ConversationView.vue`

- [ ] **Step 1: Add example preview base styles**

In the `<style scoped>` section, add these styles at the end:

```css
.example-preview {
  margin: 16px 0;
  padding: 16px;
  border-radius: 14px;
  background: rgba(102, 255, 229, 0.08);
  border: 1px solid rgba(102, 255, 229, 0.25);
  animation: example-appear 0.3s ease;
}

@keyframes example-appear {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.example-header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
}

.example-icon {
  font-size: 24px;
}

.example-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--color-primary);
}

.example-content {
  padding: 14px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.06);
  color: var(--color-primary);
  line-height: 1.6;
  margin-bottom: 12px;
  max-height: 400px;
  overflow-y: auto;
}

.example-explanation {
  padding: 10px 14px;
  border-radius: 8px;
  background: rgba(102, 255, 229, 0.12);
  margin-bottom: 12px;
}

.explanation-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--color-primary);
  opacity: 0.7;
  margin-bottom: 4px;
}

.explanation-text {
  font-size: 14px;
  color: var(--color-primary);
  line-height: 1.5;
}
```

- [ ] **Step 2: Add feedback input and button styles**

```css
.feedback-input-area {
  margin-bottom: 12px;
}

.feedback-textarea {
  width: 100%;
  border: 1px solid var(--color-glass-border);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.06);
  color: var(--color-primary);
  padding: 10px 14px;
  font-size: 14px;
  line-height: 1.5;
  resize: vertical;
  font-family: inherit;
}

.feedback-textarea:focus {
  outline: 2px solid rgba(102, 255, 229, 0.35);
}

.feedback-textarea:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.example-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}

.example-btn {
  padding: 10px 18px;
  border-radius: 10px;
  border: 1px solid var(--color-glass-border);
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
}

.example-btn-skip {
  background: rgba(255, 255, 255, 0.08);
  color: var(--color-primary);
}

.example-btn-skip:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.16);
}

.example-btn-regenerate {
  background: rgba(255, 193, 7, 0.2);
  color: var(--color-primary);
}

.example-btn-regenerate:hover:not(:disabled) {
  background: rgba(255, 193, 7, 0.35);
}

.example-btn-accept {
  background: rgba(46, 204, 113, 0.28);
  color: var(--color-primary);
}

.example-btn-accept:hover:not(:disabled) {
  background: rgba(46, 204, 113, 0.44);
}

.example-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
```

- [ ] **Step 3: Run type check**

```bash
cd D:\others\Acacia\frontend
npm run build
```

Expected: No type errors

- [ ] **Step 4: Commit styles**

```bash
cd D:\others\Acacia
git add frontend/src/components/ai/ConversationView.vue
git commit -m "feat: add example preview styles to ConversationView"
```

---

## Task 11: Handle Example Feedback in Parent Component (Frontend)

**Files:**
- Modify: `frontend/src/components/ai/FileGenerateDialog.vue`

- [ ] **Step 1: Import sendExampleFeedback from composable**

Update the destructuring from `useFileGenerate()` (around line 93):

```typescript
const {
  isOpen,
  isBusy,
  errorMessage,
  uploadedFile,
  extractionResult,
  sessionId,
  conversationState,
  needsOutlineSelection,
  extractKnowledgePoints,
  startConversation,
  sendAnswer,
  sendExampleFeedback,  // NEW
  insertGeneratedContent,
} = useFileGenerate();
```

- [ ] **Step 2: Add handleExampleFeedback function**

After the `handleSkip` function (around line 200):

```typescript
async function handleExampleFeedback(payload: { action: string; feedback?: string }) {
  if (!conversationView.value) return;

  try {
    const result = await sendExampleFeedback(payload.action as 'accept' | 'regenerate' | 'skip', payload.feedback);

    if (result.action === 'example_preview') {
      // Show new example (regenerated)
      conversationView.value.showExample(result.example_content, result.example_explanation || '');
      conversationView.value.addAiMessage(result.ai_message);
    } else if (result.action === 'regeneration_limit') {
      // Show regeneration limit message
      conversationView.value.showExample(result.example_content, result.example_explanation || '');
      conversationView.value.addAiMessage(result.ai_message);
    } else if (result.action === 'next_question') {
      // Move to next question
      conversationView.value.addAiMessage(result.ai_message);
      if (result.next_question) {
        conversationView.value.addAiMessage(result.next_question);
      }
    } else if (result.action === 'completed') {
      // All knowledge points completed
      conversationView.value.addAiMessage(result.ai_message);
      insertGeneratedContent(result.total_content);
      currentStep.value = 'completed';
    }
  } catch (error) {
    console.error('Example feedback failed:', error);
  }
}
```

- [ ] **Step 3: Add @example-feedback event handler to ConversationView**

In the template, find the `<ConversationView>` component (around line 43) and add the event handler:

```vue
<ConversationView
  ref="conversationView"
  :session-id="sessionId || ''"
  :current-index="conversationState.currentIndex"
  :total="conversationState.total"
  :current-kp-title="conversationState.currentKpTitle"
  :is-completed="conversationState.isCompleted"
  @answer="handleUserAnswer"
  @skip="handleSkip"
  @example-feedback="handleExampleFeedback"
/>
```

- [ ] **Step 4: Update handleUserAnswer to handle example_preview action**

Find the `handleUserAnswer` function (around line 165) and update it to handle the new action:

```typescript
async function handleUserAnswer(answer: string) {
  if (!conversationView.value) return;

  try {
    const result = await sendAnswer(answer);

    if (result.action === 'example_preview') {
      // Show example preview for procedure-type knowledge point
      conversationView.value.showExample(result.example_content, result.example_explanation || '');
      conversationView.value.addAiMessage(result.ai_message);
    } else if (result.action === 'follow_up' || result.action === 'hint') {
      conversationView.value.addAiMessage(result.ai_message);
    } else if (result.action === 'accept_and_next') {
      conversationView.value.addAiMessage(result.ai_message, result.generated_content);
      if (result.next_question) {
        conversationView.value.addAiMessage(result.next_question);
      }
    } else if (result.action === 'completed') {
      conversationView.value.addAiMessage(result.ai_message, result.generated_content);
      insertGeneratedContent(result.total_content);
      currentStep.value = 'completed';
    }
  } catch (error) {
    console.error('Send answer failed:', error);
  }
}
```

- [ ] **Step 5: Run type check**

```bash
cd D:\others\Acacia\frontend
npm run build
```

Expected: No type errors

- [ ] **Step 6: Commit parent component changes**

```bash
cd D:\others\Acacia
git add frontend/src/components/ai/FileGenerateDialog.vue
git commit -m "feat: handle example feedback events in FileGenerateDialog"
```

---

## Task 12: Manual Testing and Verification

**Files:**
- Test: Full conversation flow with procedure-type knowledge point

- [ ] **Step 1: Start backend server**

```bash
cd D:\others\Acacia\backend
uvicorn main:app --reload --host 0.0.0.0 --port 7860
```

Expected: Server starts without errors

- [ ] **Step 2: Start frontend dev server**

```bash
cd D:\others\Acacia\frontend
npm run dev
```

Expected: Dev server starts, opens browser

- [ ] **Step 3: Test basic flow**

Manual test checklist:
1. Login to the app
2. Create or navigate to a test node
3. Click "从文件生成知识点" button
4. Upload a file with mathematical content
5. Verify procedure-type knowledge points are extracted
6. Start conversation with procedure KP
7. Answer AI's question
8. Verify example preview appears with LaTeX rendering
9. Test Accept button → moves to next KP
10. Test Regenerate button → shows feedback textarea → new example appears
11. Test Skip button → moves to next KP without example

- [ ] **Step 4: Test edge cases**

1. Regenerate 3 times → verify limit message
2. Complex LaTeX (matrices, integrals) → verify rendering
3. Mixed Chinese + LaTeX → verify formatting
4. Empty feedback on regenerate → verify textarea shows

- [ ] **Step 5: Verify final content**

1. Complete all knowledge points
2. Check procedure KPs have examples in editor
3. Verify LaTeX renders in TipTap editor
4. Verify Markdown formatting is correct

- [ ] **Step 6: Final commit**

```bash
cd D:\others\Acacia
git add -A
git commit -m "test: verify procedure example generation feature complete"
```

---

## Verification Checklist

- [ ] All 5 knowledge point types work
- [ ] Procedure type triggers example generation
- [ ] Example preview UI displays with LaTeX
- [ ] Accept/Regenerate/Skip actions work
- [ ] Regeneration limit enforced (3 attempts)
- [ ] Non-procedure types unchanged
- [ ] Final content includes examples
- [ ] No console errors
- [ ] Type checking passes
- [ ] All commits have clear messages

---

## Rollback Plan

If issues discovered:

```bash
cd D:\others\Acacia
git log --oneline -15
git revert <commit-hash>  # Revert in reverse order
```

Or set environment flag:
```bash
export ENABLE_PROCEDURE_EXAMPLES=false
```
