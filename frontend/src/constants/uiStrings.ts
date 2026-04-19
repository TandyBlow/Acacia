export const UI = {
  // App-level
  app: {
    errorOccurred: '应用遇到了一个错误，请重试。',
    retry: '重试',
  },

  // Navigation
  nav: {
    move: '移动',
    delete: '删除',
    addNode: '+ 添加节点',
    authTip: '注册或登录以继续',
  },

  // Auth
  auth: {
    register: '注册',
    login: '登录',
    hint: '短按右侧旋钮切换登录/注册，长按旋钮提交。',
    username: '账号',
    password: '密码',
    confirmPassword: '确认密码',
  },

  // Confirm panels
  confirm: {
    addNode: '添加节点',
    deleteNode: '删除节点',
    logout: '退出登录',
    logoutPrompt: (username: string) => `当前账号为${username}，请确认退出操作。`,
  },

  // Breadcrumbs
  breadcrumbs: {
    home: '主页',
    welcome: '欢迎！',
  },

  // Knob
  knob: {
    holdToConfirm: '长按旋钮确认',
    clickToHome: '点击旋钮返回主页面',
    clickToReturn: '点击旋钮返回',
  },

  // Global Tree
  tree: {
    moveNode: '移动节点',
    home: '主页',
    devTagNodes: '打标签',
    devTestSakura: '测试樱花',
    sakuraDomainTag: '日本文化',
    noBackend: '树可视化需要后端连接',
  },

  // Error messages
  errors: {
    unknown: '发生了未知错误',
    authFailed: '认证失败，请稍后重试。',
    unknownUser: '未知用户',
    authNotInitialized: '认证服务未初始化。',
    passwordMismatch: '两次输入的密码不一致。',
    nodeNameEmpty: '节点名称不能为空。',
    nodeNotFound: '未找到该节点。',
    parentNotFound: '目标父节点不存在。',
    cannotMoveToChild: '不能将节点移动到自身或其子节点下。',
    siblingNameConflict: '同一父节点下已存在同名节点。',
    createNodeFailed: '创建节点失败。',
    supabaseNotConfigured: 'Supabase 未配置。请设置 VITE_SUPABASE_URL 和 VITE_SUPABASE_ANON_KEY。',
    usernameEmpty: '用户名不能为空。',
    passwordEmpty: '密码不能为空。',
    usernameTaken: '该用户名已被注册。',
    usernamePasswordEmpty: '用户名和密码不能为空。',
    usernamePasswordWrong: '用户名或密码错误。',
    signupSuccessNoUser: '注册成功但无法获取用户信息。',
    loginFailed: '登录失败，请稍后重试。',
    emailConfirmHint: '当前项目仍开启了邮箱确认。请在 Supabase Authentication 设置中关闭 Confirm email。',
    treeSkeletonRequiresBackend: 'Tree skeleton requires a backend connection.',
  },
} as const;
