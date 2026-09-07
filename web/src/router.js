import { createRouter, createWebHistory } from "vue-router";
import { useAuth } from "./composables/useAuth.js";
import HomeView from "./views/HomeView.vue";
import LoginView from "./views/LoginView.vue";
import ScalpView from "./views/ScalpView.vue";
import StockDetailView from "./views/StockDetailView.vue";
import FundsView from "./views/FundsView.vue";
import MyFundsView from "./views/MyFundsView.vue";

export const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: "/login",
      name: "login",
      component: LoginView,
      meta: { public: true },
    },
    { path: "/", name: "home", component: HomeView },
    { path: "/scalp", name: "scalp", component: ScalpView },
    { path: "/funds/mine", name: "my-funds", component: MyFundsView },
    { path: "/funds", name: "funds", component: FundsView },
    { path: "/my-funds", redirect: "/funds/mine" },
    { path: "/stock/:ticker", name: "stock", component: StockDetailView, props: true },
  ],
  scrollBehavior() {
    return { top: 0 };
  },
});

router.beforeEach((to) => {
  const { isAuthenticated, loginViaBypass, hasBypassQuery, stripBypassQuery } = useAuth();

  // Dev backdoor: ?devbypass=1 logs you in and strips the param from the URL.
  if (hasBypassQuery(to.query)) {
    loginViaBypass();
    return {
      path: to.path,
      query: stripBypassQuery(to.query),
      hash: to.hash,
      replace: true,
    };
  }

  if (to.meta.public) {
    if (isAuthenticated.value && to.name === "login") {
      return { name: "home" };
    }
    return true;
  }
  if (!isAuthenticated.value) {
    return {
      name: "login",
      query: { redirect: to.fullPath },
    };
  }
  return true;
});
