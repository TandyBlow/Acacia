# Procedure Knowledge Point Example Generation Design

**Date:** 2026-05-07  
**Status:** Approved

## Context

The current conversation-based knowledge point generation system helps users understand concepts through dialogue, but lacks practical methodology guidance. When users discuss mathematical methods like Newton's method, they understand the concept but cannot apply it in practice because:

1. Users cannot easily type mathematical formulas during conversation
2. Generated notes lack concrete calculation examples
3. No verification that AI-generated examples match user understanding

This design adds a "procedure" knowledge point type with example generation and multi-round confirmation to ensure examples align with user comprehension.

## Goals

1. Enable AI to generate complete calculation examples (with LaTeX formulas) for procedure-type knowledge points
2. Provide multi-round confirmation loop so users can verify examples match their understanding
3. Support three outcomes: accept (write to notes), regenerate (with feedback), or skip (text-only notes)
4. Maintain existing flow for non-procedure knowledge points

## Design

### 1. Knowledge Point Type Extension

**Current types:**
- `concept` — "What is X?"
- `principle` — "How does X work?"
- `application` — "How to use X?"
- `comparison` — "X vs Y?"

**New type:**
- `procedure` — Methods requiring step-by-step calculation examples (e.g., Newton's method, integration techniques, matrix operations)

**Backend change:** Update `KNOWLEDGE_EXTRACTION_PROMPT` in `file_knowledge_service.py` to include `procedure` type with description: "需要计算步骤示例的方法（如牛顿法、积分技巧、矩阵运算等）"

**Frontend change:** Update `KnowledgePoint` type in `useFileGenerate.ts`:
```typescript
type: 'concept' | 'principle' | 'application' | 'comparison' | 'procedure';
```

### 2. Example Generation Function

**New function:** `generate_example_for_procedure(kp, user_answer, conversation_history) -> dict`

**Prompt template:**
```python
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
"""
```

**Input:**
- `kp`: Knowledge point dict (title, type, brief)
- `user_answer`: User's final answer explaining their understanding
- `conversation_history`: Full conversation for this knowledge point

**Output:**
```python
{
  "example_content": "## 例题\n\n求 $f(x) = x^2 - 2$ 的根...",
  "explanation": "这个例题展示了牛顿法的迭代过程..."
}
```

### 3. Conversation Flow Modification

**Current flow for all types:**
```
Question → Answer → Evaluate → (follow_up/hint loop) → Accept → Generate content → Next KP
```

**New flow for procedure type:**
```
Question → Answer → Evaluate → (follow_up/hint loop) → Accept → Generate example → 
Example preview → User feedback:
  - Accept → Generate final content (with example) → Next KP
  - Regenerate → User provides feedback → Generate new example → Example preview (loop)
  - Skip → Generate content (text only) → Next KP
```

**Backend changes in `process_conversation_turn()`:**

When `action == "accept"` and `current_kp["type"] == "procedure"`:
1. Generate example using `generate_example_for_procedure()`
2. Store example in session: `session["pending_example"] = example_data`
3. Return:
```python
{
  "action": "example_preview",
  "ai_message": "我根据你的理解生成了一个例题，看看是否符合你的想法？",
  "example_content": example_data["example_content"],
  "example_explanation": example_data["explanation"],
  "progress": {...}
}
```

### 4. Example Feedback Processing

**New function:** `process_example_feedback(session_id, action, feedback=None) -> dict`

**Parameters:**
- `session_id`: Current conversation session
- `action`: `"accept"` | `"regenerate"` | `"skip"`
- `feedback`: User's feedback text (required for regenerate)

**Logic:**

**If action == "accept":**
1. Retrieve `session["pending_example"]`
2. Generate final note content = user understanding + example
3. Append to `session["generated_content"]`
4. Move to next knowledge point
5. Return next question or completion

**If action == "regenerate":**
1. Call `generate_example_for_procedure()` with additional context:
   - Previous example: `session["pending_example"]`
   - User feedback: `feedback` parameter
2. Update `session["pending_example"]`
3. Return new example preview

**If action == "skip":**
1. Generate note content without example (text only)
2. Append to `session["generated_content"]`
3. Move to next knowledge point
4. Return next question or completion

**Regeneration prompt enhancement:**
```python
# When regenerating, add to the prompt:
f"""
之前生成的例题：
{previous_example}

用户的反馈：
{user_feedback}

请根据反馈重新生成一个不同的例题。
"""
```

### 5. API Changes

**New endpoint:** `POST /example-feedback`

**Request model:**
```python
class ExampleFeedbackRequest(BaseModel):
    session_id: str
    action: Literal["accept", "regenerate", "skip"]
    feedback: str | None = None  # Required for regenerate
```

**Response:**
- If accept/skip and more KPs remain: `{ action: "next_question", next_question: "...", ... }`
- If accept/skip and all complete: `{ action: "completed", total_content: "...", ... }`
- If regenerate: `{ action: "example_preview", example_content: "...", ... }`

**Existing endpoint modification:** `/conversation-turn` response can now include `action: "example_preview"`

### 6. Frontend Changes

**`useFileGenerate.ts` additions:**

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

**`ConversationView.vue` additions:**

1. **New state:** `isShowingExample` ref to track example preview mode
2. **New prop/data:** `currentExample` to store example content
3. **New UI section:** Example preview card with:
   - Rendered LaTeX content (KaTeX already supported)
   - Three action buttons:
     - ✅ "这个例题符合我的理解" → accept
     - 🔄 "重新生成" → show feedback textarea → regenerate
     - ⏭️ "跳过例题" → skip
4. **Feedback textarea:** Shown when user clicks regenerate button

**UI flow:**
```
Normal conversation → AI sends example_preview → 
Show example card with buttons → User clicks button:
  - Accept: emit('example-feedback', { action: 'accept' })
  - Regenerate: show textarea → user types → emit('example-feedback', { action: 'regenerate', feedback })
  - Skip: emit('example-feedback', { action: 'skip' })
```

**Parent component (`FileGenerateDialog.vue`) handles:**
```typescript
async function handleExampleFeedback(payload: { action: string; feedback?: string }) {
  try {
    const result = await sendExampleFeedback(payload.action, payload.feedback);
    
    if (result.action === 'example_preview') {
      // Show new example
      conversationView.value?.showExample(result.example_content, result.example_explanation);
    } else if (result.action === 'next_question') {
      // Move to next question
      conversationView.value?.addAiMessage(result.ai_message);
      if (result.generated_content) {
        // Optionally show "content generated" indicator
      }
    } else if (result.action === 'completed') {
      // Insert all generated content
      insertGeneratedContent(result.total_content);
      currentStep.value = 'completed';
    }
  } catch (error) {
    console.error('Example feedback failed:', error);
  }
}
```

### 7. Session State Extension

**Add to session dict:**
```python
{
  # ... existing fields ...
  "pending_example": {
    "example_content": "...",
    "explanation": "...",
    "generation_count": 1  # Track regeneration attempts
  } | None,
  "example_history": []  # Store previous examples for context
}
```

### 8. Error Handling

1. **Example generation timeout:** If DeepSeek API times out, return error and allow retry
2. **Invalid LaTeX:** Catch KaTeX rendering errors in frontend, show raw content with warning
3. **Regeneration limit:** After 3 regeneration attempts, suggest skip option
4. **Session expiry:** If session expires during example confirmation, show error and close dialog

## Non-Goals

- Automatic detection of which knowledge points need examples (relies on AI classification)
- Interactive formula editor (users provide feedback in natural language)
- Multiple example variants shown simultaneously (one at a time, regenerate if needed)
- Example difficulty levels (generates one appropriate example based on conversation)

## Testing Strategy

1. **Unit tests:**
   - `generate_example_for_procedure()` with various knowledge points
   - `process_example_feedback()` for all three actions
   - LaTeX parsing and rendering in frontend

2. **Integration tests:**
   - Full conversation flow for procedure-type knowledge point
   - Regeneration loop (accept after 2 regenerations)
   - Skip flow (verify text-only content generated)

3. **Manual testing:**
   - Test with real mathematical topics: Newton's method, integration by parts, matrix inversion
   - Verify LaTeX renders correctly in editor
   - Test edge cases: very long examples, complex formulas, Chinese + LaTeX mixed content

## Implementation Notes

1. **LaTeX safety:** Ensure generated LaTeX is valid before sending to frontend (basic syntax check)
2. **Content length:** Limit example content to 500 words to avoid overwhelming users
3. **Regeneration context:** Pass previous examples to AI to avoid generating identical content
4. **Mobile support:** Example preview card should be responsive and scrollable
5. **Accessibility:** Ensure buttons have clear labels and keyboard navigation works

## Future Enhancements (Out of Scope)

- Allow users to edit examples directly in a formula editor
- Generate multiple difficulty levels (beginner/intermediate/advanced)
- Save example generation preferences per user
- Support for diagrams and graphs in examples
