// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  mode,
  sessionId,
  messages,
  generatedContent,
  isBusy,
  errorMessage,
  referenceText,
  referenceFileName,
  currentNodeId,
  currentSubTopic,
  totalKp,
  currentKpIndex,
  currentKpData,
  isCompleted,
  openingMessage,
  contextChain,
  newLearnings,
  mentionedConcepts,
  markedConceptNames,
  hasActiveConversation,
  hasResumableSession,
  resetForNewNode,
  clearChat,
  abandonChat,
  setTextMode,
  setFileMode,
  findLastAiMessageIndex,
  _updateConcepts,
} from './chatState';

const mocks = vi.hoisted(() => ({
  loadCheckpointForNode: vi.fn(),
  clearCheckpointForNode: vi.fn(),
}));

vi.mock('./chatCheckpoint', () => ({
  loadCheckpointForNode: mocks.loadCheckpointForNode,
  clearCheckpointForNode: mocks.clearCheckpointForNode,
}));

const conceptA = {
  name: 'A',
  category: 'cat',
  definition: 'def',
  prerequisites: ['p1'],
  expansion_directions: ['e1'],
  verified: true,
  wiki_summary: 'ws',
  wiki_description: 'wd',
};

function resetState() {
  mode.value = 'idle';
  sessionId.value = null;
  messages.value = [];
  generatedContent.value = '';
  isBusy.value = false;
  errorMessage.value = '';
  referenceText.value = '';
  referenceFileName.value = null;
  currentNodeId.value = null;
  currentSubTopic.value = '';
  totalKp.value = 1;
  currentKpIndex.value = 0;
  currentKpData.value = null;
  isCompleted.value = false;
  mentionedConcepts.value = [];
  markedConceptNames.value = new Set();
}

describe('chatState module', () => {
  beforeEach(() => {
    resetState();
    vi.clearAllMocks();
  });

  describe('module-level refs', () => {
    it('exposes refs with their documented default values', () => {
      expect(mode.value).toBe('idle');
      expect(sessionId.value).toBeNull();
      expect(messages.value).toEqual([]);
      expect(generatedContent.value).toBe('');
      expect(isBusy.value).toBe(false);
      expect(errorMessage.value).toBe('');
      expect(referenceText.value).toBe('');
      expect(referenceFileName.value).toBeNull();
      expect(currentNodeId.value).toBeNull();
      expect(currentSubTopic.value).toBe('');
      expect(totalKp.value).toBe(1);
      expect(currentKpIndex.value).toBe(0);
      expect(currentKpData.value).toBeNull();
      expect(isCompleted.value).toBe(false);
      expect(openingMessage.value).toBe('');
      expect(contextChain.value).toEqual([]);
      expect(newLearnings.value).toEqual([]);
      expect(mentionedConcepts.value).toEqual([]);
      expect(markedConceptNames.value.size).toBe(0);
    });
  });

  describe('hasActiveConversation', () => {
    it('is true only when a session exists and mode is conversing', () => {
      expect(hasActiveConversation.value).toBe(false);

      sessionId.value = 's1';
      expect(hasActiveConversation.value).toBe(false);

      mode.value = 'conversing';
      expect(hasActiveConversation.value).toBe(true);

      mode.value = 'paused';
      expect(hasActiveConversation.value).toBe(false);

      mode.value = 'conversing';
      sessionId.value = null;
      expect(hasActiveConversation.value).toBe(false);
    });
  });

  describe('hasResumableSession', () => {
    it('is false when no checkpoint exists for the node', () => {
      mocks.loadCheckpointForNode.mockReturnValue(null);
      currentNodeId.value = 'n1';

      expect(hasResumableSession.value).toBe(false);
      expect(mocks.loadCheckpointForNode).toHaveBeenCalledWith('n1');
    });

    it('is true for conversing or paused checkpoints', () => {
      mocks.loadCheckpointForNode.mockReturnValue({ mode: 'conversing' });
      currentNodeId.value = 'n2';
      expect(hasResumableSession.value).toBe(true);

      mocks.loadCheckpointForNode.mockReturnValue({ mode: 'paused' });
      currentNodeId.value = 'n3';
      expect(hasResumableSession.value).toBe(true);
    });

    it('is false for other checkpoint modes', () => {
      mocks.loadCheckpointForNode.mockReturnValue({ mode: 'text_input' });
      currentNodeId.value = 'n4';
      expect(hasResumableSession.value).toBe(false);
    });
  });

  describe('resetForNewNode', () => {
    it('clears conversation state but leaves mode untouched', () => {
      mode.value = 'conversing';
      sessionId.value = 's1';
      messages.value = [{ role: 'user', content: 'x' }];
      generatedContent.value = 'g';
      errorMessage.value = 'err';
      referenceText.value = 'ref';
      referenceFileName.value = 'f.txt';
      currentSubTopic.value = 'sub';
      totalKp.value = 7;
      currentKpIndex.value = 3;
      currentKpData.value = { k: 1 };
      isCompleted.value = true;
      mentionedConcepts.value = [conceptA];
      markedConceptNames.value = new Set(['A']);

      resetForNewNode();

      expect(mode.value).toBe('conversing');
      expect(sessionId.value).toBeNull();
      expect(messages.value).toEqual([]);
      expect(generatedContent.value).toBe('');
      expect(errorMessage.value).toBe('');
      expect(referenceText.value).toBe('');
      expect(referenceFileName.value).toBeNull();
      expect(currentSubTopic.value).toBe('');
      expect(totalKp.value).toBe(1);
      expect(currentKpIndex.value).toBe(0);
      expect(currentKpData.value).toBeNull();
      expect(isCompleted.value).toBe(false);
      expect(mentionedConcepts.value).toEqual([]);
      expect(markedConceptNames.value.size).toBe(0);
      expect(mocks.clearCheckpointForNode).not.toHaveBeenCalled();
    });
  });

  describe('clearChat', () => {
    it('switches to text_input mode and clears the checkpoint for the current node', () => {
      currentNodeId.value = 'n1';
      mode.value = 'conversing';
      sessionId.value = 's1';
      messages.value = [{ role: 'user', content: 'x' }];
      generatedContent.value = 'g';
      mentionedConcepts.value = [conceptA];
      markedConceptNames.value = new Set(['A']);

      clearChat();

      expect(mode.value).toBe('text_input');
      expect(sessionId.value).toBeNull();
      expect(messages.value).toEqual([]);
      expect(generatedContent.value).toBe('');
      expect(mentionedConcepts.value).toEqual([]);
      expect(markedConceptNames.value.size).toBe(0);
      expect(mocks.clearCheckpointForNode).toHaveBeenCalledWith('n1');
    });
  });

  describe('abandonChat', () => {
    it('switches to idle mode and clears the checkpoint for the current node', () => {
      currentNodeId.value = 'n1';
      mode.value = 'conversing';
      sessionId.value = 's1';
      messages.value = [{ role: 'user', content: 'x' }];
      generatedContent.value = 'g';

      abandonChat();

      expect(mode.value).toBe('idle');
      expect(sessionId.value).toBeNull();
      expect(messages.value).toEqual([]);
      expect(generatedContent.value).toBe('');
      expect(mocks.clearCheckpointForNode).toHaveBeenCalledWith('n1');
    });
  });

  describe('setTextMode', () => {
    it('switches to text_input and clears file reference and error', () => {
      mode.value = 'idle';
      referenceFileName.value = 'file.txt';
      errorMessage.value = 'oops';

      setTextMode();

      expect(mode.value).toBe('text_input');
      expect(referenceFileName.value).toBeNull();
      expect(errorMessage.value).toBe('');
    });
  });

  describe('setFileMode', () => {
    it('switches to file_upload and clears reference text and error', () => {
      mode.value = 'idle';
      referenceText.value = 'some text';
      errorMessage.value = 'oops';

      setFileMode();

      expect(mode.value).toBe('file_upload');
      expect(referenceText.value).toBe('');
      expect(errorMessage.value).toBe('');
    });
  });

  describe('findLastAiMessageIndex', () => {
    it('returns the index of the last ai message', () => {
      messages.value = [
        { role: 'user', content: 'a' },
        { role: 'ai', content: 'b' },
        { role: 'user', content: 'c' },
        { role: 'ai', content: 'd' },
      ];
      expect(findLastAiMessageIndex()).toBe(3);
    });

    it('returns -1 when there is no ai message', () => {
      messages.value = [{ role: 'user', content: 'a' }];
      expect(findLastAiMessageIndex()).toBe(-1);
    });

    it('returns -1 for an empty message list', () => {
      expect(findLastAiMessageIndex()).toBe(-1);
    });
  });

  describe('_updateConcepts', () => {
    it('appends new mentioned concepts with their full fields', () => {
      _updateConcepts({
        mentioned_concepts: [conceptA],
      });

      expect(mentionedConcepts.value).toHaveLength(1);
      expect(mentionedConcepts.value[0]).toEqual(conceptA);
    });

    it('applies defaults for missing optional fields', () => {
      _updateConcepts({ mentioned_concepts: [{ name: '只名字' }] });

      expect(mentionedConcepts.value[0]).toEqual({
        name: '只名字',
        category: '',
        definition: '',
        prerequisites: [],
        expansion_directions: [],
        verified: false,
        wiki_summary: '',
        wiki_description: '',
      });
    });

    it('does not duplicate concepts already present', () => {
      _updateConcepts({ mentioned_concepts: [{ name: 'A' }] });
      _updateConcepts({ mentioned_concepts: [{ name: 'A' }, { name: 'B' }] });

      expect(mentionedConcepts.value.map(c => c.name)).toEqual(['A', 'B']);
    });

    it('preserves existing concepts when appending new ones', () => {
      _updateConcepts({ mentioned_concepts: [{ name: 'A' }] });
      _updateConcepts({ mentioned_concepts: [{ name: 'B' }] });

      expect(mentionedConcepts.value.map(c => c.name)).toEqual(['A', 'B']);
    });

    it('ignores data without mentioned_concepts or with an empty array', () => {
      _updateConcepts({});
      _updateConcepts({ mentioned_concepts: [] });

      expect(mentionedConcepts.value).toEqual([]);
    });
  });
});
