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
