import { watch, type Ref } from 'vue';
import { useAuthStore } from '../stores/authStore';
import { useNodeStore } from '../stores/nodeStore';

// 5 accounts — each has different node tree → different 3D skeleton + pre-stored style
const ACCOUNTS = [
  { username: 'demo_cs',   password: 'demo123', domain: '计算机科学', style: '蔚蓝', nodes: 15 },
  { username: 'demo_math', password: 'demo123', domain: '数学逻辑',   style: '金辉', nodes: 7  },
  { username: 'demo_lit',  password: 'demo123', domain: '文学艺术',   style: '樱粉', nodes: 7  },
  { username: 'demo_bio',  password: 'demo123', domain: '生物学',     style: '翠绿', nodes: 10 },
  { username: 'demo_phil', password: 'demo123', domain: '哲学思辨',   style: '紫晶', nodes: 6  },
];

export function useDemoAutopilot(initialized: Ref<boolean>, isAuthenticated: Ref<boolean>) {
  if (typeof window === 'undefined' || !window.location.search.includes('demo')) return;

  const authStore = useAuthStore();
  const nodeStore = useNodeStore();

  let acctIdx = 0;
  let cycleTimer: ReturnType<typeof setTimeout> | null = null;
  let running = false;

  async function switchToAccount(idx: number) {
    const acct = ACCOUNTS[idx % ACCOUNTS.length];
    console.log(`[demo] 账号: ${acct.username} | ${acct.domain} · ${acct.style} | ${acct.nodes}节点`);

    // Logout current
    if (isAuthenticated.value) {
      await authStore.logout();
      await new Promise(r => setTimeout(r, 1000));
    }

    // Login next
    authStore.mode = 'login';
    authStore.username = acct.username;
    authStore.password = acct.password;
    await authStore.submitByKnob();

    // Let tree render + style load (entrance anim ~2s + tree build ~2s + style fetch)
    await new Promise(r => setTimeout(r, 6000));

    // Quick view cycle within this account
    showViews();

    // Schedule next account switch (20s total per account)
    cycleTimer = setTimeout(() => {
      acctIdx++;
      switchToAccount(acctIdx);
    }, 20000);
  }

  function showViews() {
    // Show tree overview first, then a node, then back
    setTimeout(() => { try { nodeStore.startTreeOverview(); } catch {} }, 1000);
    setTimeout(() => { try { nodeStore.loadNode(null); } catch {} }, 6000);
    setTimeout(() => { try { nodeStore.startDailyQuiz(); } catch {} }, 11000);
  }

  const unwatch = watch(initialized, async (val) => {
    if (!val) return;
    unwatch();
    await new Promise(r => setTimeout(r, 600));
    running = true;
    await switchToAccount(0);
  }, { immediate: true });
}
