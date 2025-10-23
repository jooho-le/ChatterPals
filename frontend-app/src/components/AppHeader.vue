<template>
  <header class="app-header" role="banner">
    <div class="app-header__inner">
      <RouterLink
        to="/"
        class="logo"
        aria-label="Chatterpals Home"
        @click="closeNav"
      >
        <img src="../../public/logo.png" alt="Chatterpals 로고" class="logo-img" />
        <span class="logo-text">Chatterpals</span>
      </RouterLink>

      <button
        class="menu-toggle"
        type="button"
        aria-label="메뉴 열기"
        @click="toggleNav"
      >
        <span></span>
        <span></span>
        <span></span>
      </button>

      <nav class="nav" :class="{ open: navOpen }">
        <RouterLink to="/" @click="closeNav">Home</RouterLink>
        <RouterLink to="/level-test" @click="closeNav">Level Test</RouterLink>
        <RouterLink to="/aitutor" @click="closeNav">AI 튜터</RouterLink>
        <RouterLink to="/studylog" @click="closeNav">Study Log</RouterLink>
        <RouterLink to="/ranking" @click="closeNav">Ranking</RouterLink>
      </nav>

      <div class="auth-actions" aria-live="polite" :class="{ open: navOpen }">
        <template v-if="isAuthenticated">
          <span class="welcome">안녕하세요, {{ user?.nickname }}님</span>
          <button class="link-button" type="button" @click="goMyPage">마이페이지</button>
          <button class="primary" type="button" @click="logoutUser">로그아웃</button>
        </template>
        <template v-else>
          <button class="link-button" type="button" @click="() => { closeNav(); openLogin() }">로그인</button>
          <button class="primary" type="button" @click="() => { closeNav(); openSignup() }">회원가입</button>
        </template>
      </div>
    </div>

    <!-- 로그인 모달 -->
    <Teleport to="body">
      <div
        v-if="showLogin"
        class="modal-backdrop"
        role="dialog"
        aria-modal="true"
        @click.self="closeDialogs"
      >
        <section class="modal">
          <header class="modal-header">
            <h2>로그인</h2>
            <button class="icon-button" type="button" @click="closeDialogs" aria-label="닫기">×</button>
          </header>
          <form class="modal-body" @submit.prevent="handleLogin">
            <label>
              아이디(ID)
              <input v-model.trim="loginForm.username" type="text" autocomplete="username" required />
            </label>
            <label>
              비밀번호
              <input v-model.trim="loginForm.password" type="password" autocomplete="current-password" required />
            </label>
            <p v-if="authError" class="error">{{ authError }}</p>
            <button class="primary full" type="submit" :disabled="loading">{{ loading ? '로그인 중...' : '로그인' }}</button>
            <p class="switch-message">계정이 없나요? <button type="button" class="link-button" @click="switchToSignup">회원가입</button></p>
          </form>
        </section>
      </div>
    </Teleport>

    <!-- 회원가입 모달 -->
    <Teleport to="body">
      <div
        v-if="showSignup"
        class="modal-backdrop"
        role="dialog"
        aria-modal="true"
        @click.self="closeDialogs"
      >
        <section class="modal">
          <header class="modal-header">
            <h2>회원가입</h2>
            <button class="icon-button" type="button" @click="closeDialogs" aria-label="닫기">×</button>
          </header>
          <form class="modal-body" @submit.prevent="handleSignup">
            <label>
              아이디(ID)
              <input v-model.trim="signupForm.username" type="text" autocomplete="username" required minlength="3" />
            </label>
            <label>
              닉네임
              <input v-model.trim="signupForm.nickname" type="text" required minlength="1" />
            </label>
            <label>
              비밀번호
              <input v-model.trim="signupForm.password" type="password" autocomplete="new-password" required minlength="6" />
            </label>
            <p v-if="authError" class="error">{{ authError }}</p>
            <p v-if="authSuccess" class="success">{{ authSuccess }}</p>
            <button class="primary full" type="submit" :disabled="loading">{{ loading ? '가입 중...' : '회원가입' }}</button>
            <p class="switch-message">이미 계정이 있나요? <button type="button" class="link-button" @click="switchToLogin">로그인</button></p>
          </form>
        </section>
      </div>
    </Teleport>
  </header>
</template>

<script setup lang="ts">
import { reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useAuth } from '@/composables/useAuth'

const router = useRouter()
const { user, isAuthenticated, login, signup, logout, loading } = useAuth()

const showLogin = ref(false)
const showSignup = ref(false)
const loginForm = reactive({ username: '', password: '' })
const signupForm = reactive({ username: '', nickname: '', password: '' })
const authError = ref('')
const authSuccess = ref('')
const navOpen = ref(false)

function resetForms() {
  authError.value = ''
  authSuccess.value = ''
}

function openLogin() {
  resetForms()
  showSignup.value = false
  showLogin.value = true
}

function openSignup() {
  resetForms()
  showLogin.value = false
  showSignup.value = true
}

function switchToSignup() {
  openSignup()
}

function switchToLogin() {
  openLogin()
}

function closeDialogs() {
  showLogin.value = false
  showSignup.value = false
}

function toggleNav() {
  navOpen.value = !navOpen.value
}

function closeNav() {
  navOpen.value = false
}

async function handleLogin() {
  authError.value = ''
  try {
    await login(loginForm.username, loginForm.password)
    closeDialogs()
    closeNav()
    loginForm.username = ''
    loginForm.password = ''
    router.push('/mypage')
  } catch (error) {
    authError.value = error instanceof Error ? error.message : '로그인에 실패했습니다.'
  }
}

async function handleSignup() {
  authError.value = ''
  authSuccess.value = ''
  try {
    await signup(signupForm.username, signupForm.nickname, signupForm.password)
    authSuccess.value = '회원가입이 완료되었습니다. 자동으로 로그인되었습니다.'
    signupForm.username = ''
    signupForm.nickname = ''
    signupForm.password = ''
    setTimeout(() => {
      closeDialogs()
      closeNav()
      router.push('/mypage')
    }, 600)
  } catch (error) {
    authError.value = error instanceof Error ? error.message : '회원가입에 실패했습니다.'
  }
}

function logoutUser() {
  logout()
  closeNav()
  router.push('/')
}

function goMyPage() {
  closeNav()
  router.push('/mypage')
}

watch(
  () => router.currentRoute.value.fullPath,
  () => {
    closeNav()
  },
)
</script>

<style scoped>
.app-header {
  position: sticky;
  top: 0;
  left: 0;
  right: 0;
  z-index: 1000;
  width: 100%;
  isolation: isolate;
}

.app-header::before {
  content: "";
  position: absolute;
  inset: 0;
  background: #fff;
  border-bottom: 1px solid rgba(226, 232, 240, 0.8);
  box-shadow: 0 6px 24px rgba(15, 23, 42, 0.05);
  pointer-events: none;
  z-index: -1;
}

.app-header__inner {
  box-sizing: border-box;
  width: 100%;
  max-width: 1100px;
  margin: 0 auto;
  padding: 0.75rem clamp(16px, 4vw, 32px);
  display: flex;
  align-items: center;
  gap: 1rem;
}

.logo {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-right: auto;
  text-decoration: none;
}

.logo-img {
  width: 48px;
  height: 48px;
  object-fit: contain;
}

.logo-text {
  font-weight: 800;
  font-size: clamp(1.25rem, 1rem + 0.9vw, 1.9rem);
  background: linear-gradient(90deg, #0ea5e9, #63f1cd, #f7a655);
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
}

.menu-toggle {
  display: none;
  flex-direction: column;
  gap: 4px;
  background: transparent;
  border: none;
  cursor: pointer;
  padding: 0.4rem;
}

.menu-toggle span {
  width: 24px;
  height: 2px;
  background: #111827;
}

.nav {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: clamp(12px, 1.8vw, 24px);
}

.nav a {
  text-decoration: none;
  color: #111827;
  font-weight: 600;
}

.nav a.router-link-active {
  text-decoration: underline;
}

.auth-actions {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.welcome {
  font-weight: 600;
}

/* 모달 기본 스타일은 기존과 동일 */
.modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.48);
  display: grid;
  place-items: center;
  padding: clamp(16px, 5vw, 32px);
  box-sizing: border-box;
  overflow-y: auto;
  z-index: 1100;
}

.modal {
  background: #fff;
  width: min(400px, 92vw);
  border-radius: 20px;
  box-shadow: 0 32px 60px rgba(15, 23, 42, 0.2);
  overflow: hidden;
  max-height: min(90vh, 560px);
  display: flex;
  flex-direction: column;
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1.25rem 1.5rem;
  background: linear-gradient(135deg, #2563eb, #0ea5e9);
  color: #fff;
}

.modal-body {
  padding: 1.5rem;
  display: grid;
  gap: 1rem;
  overflow-y: auto;
  flex: 1 1 auto;
}

.modal-body label {
  display: grid;
  gap: 0.35rem;
  font-weight: 600;
}

.modal-body input {
  padding: 0.65rem 0.75rem;
  border-radius: 12px;
  border: 1px solid #d1d5db;
}

.switch-message {
  margin: 0;
  text-align: center;
}

.primary {
  border: none;
  background: linear-gradient(135deg, #2563eb, #0ea5e9);
  color: #fff;
  padding: 0.6rem 1.25rem;
  border-radius: 999px;
  font-weight: 600;
  cursor: pointer;
}

.primary.full {
  width: 100%;
}

.link-button {
  background: none;
  border: none;
  color: #2563eb;
  font-weight: 600;
  cursor: pointer;
}

.icon-button {
  background: none;
  border: none;
  color: inherit;
  font-size: 1.5rem;
  cursor: pointer;
}

.error {
  color: #dc2626;
  margin: 0;
}

.success {
  color: #16a34a;
  margin: 0;
}

@media (max-width: 820px) {
  .app-header__inner {
    flex-wrap: wrap;
    gap: 0.75rem;
  }

  .menu-toggle {
    display: inline-flex;
    margin-left: auto;
  }

  .nav {
    order: 3;
    width: 100%;
    display: none;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.75rem;
    padding: 0.75rem 0;
    border-top: 1px solid rgba(148, 163, 184, 0.3);
  }

  .nav.open {
    display: flex;
  }

  .auth-actions {
    order: 2;
    width: 100%;
    justify-content: flex-end;
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  .auth-actions.open {
    border-top: 1px solid rgba(148, 163, 184, 0.2);
    padding-top: 0.5rem;
  }

  .welcome {
    flex-basis: 100%;
    text-align: right;
  }
}
</style>
