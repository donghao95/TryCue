import { useCallback, useEffect, useRef } from "react";

export type NavigationGuard = {
  isDirty: () => boolean;
  confirm: () => Promise<boolean>;
};

export type NavigationGuardHandle = {
  register: (guard: NavigationGuard) => () => void;
  confirmLeave: () => Promise<boolean>;
  isDirty: () => boolean;
};

/**
 * 导航守卫 hook。
 *
 * 使用方式：
 * 1. 在 App.tsx 调用 useNavigationGuard() 获得 handle
 * 2. navigateTo 和 popstate 调用 handle.confirmLeave()，返回 false 则取消跳转
 * 3. 各页面调用 handle.register({ isDirty, confirm }) 注册自己的 dirty 检查
 *
 * confirm 使用 window.confirm 作为最简实现，避免引入额外弹窗状态。
 * 如果需要自定义弹窗，可以替换 confirm 实现。
 */
export function useNavigationGuard(): NavigationGuardHandle {
  const guardRef = useRef<NavigationGuard | null>(null);
  const isConfirmingRef = useRef(false);

  const register = useCallback((guard: NavigationGuard) => {
    guardRef.current = guard;
    return () => {
      if (guardRef.current === guard) {
        guardRef.current = null;
      }
    };
  }, []);

  const isDirty = useCallback(() => {
    return guardRef.current?.isDirty() ?? false;
  }, []);

  const confirmLeave = useCallback(async () => {
    // 防并发：如果已经在确认中，直接返回 false 取消后续跳转
    if (isConfirmingRef.current) return false;
    const guard = guardRef.current;
    if (!guard || !guard.isDirty()) return true;
    isConfirmingRef.current = true;
    try {
      return await guard.confirm();
    } finally {
      isConfirmingRef.current = false;
    }
  }, []);

  // beforeunload：dirty 时提示浏览器原生确认
  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (guardRef.current?.isDirty()) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, []);

  return { register, confirmLeave, isDirty };
}
