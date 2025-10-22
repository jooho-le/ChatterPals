import { createRouter, createWebHistory } from 'vue-router'
import Home from '../views/Home.vue'
import LevelTest from '../views/LevelTest.vue'
import AITutor from '../views/AITutor.vue'
import StudyLog from '../views/StudyLog.vue'
import Ranking from '../views/Ranking.vue'
import MyPage from '../views/MyPage.vue'
import RecordDetail from '../views/RecordDetail.vue'
import ShareCapture from '../views/ShareCapture.vue'

const routes = [
  {
    path: '/',
    name: 'Home',
    component: Home,
  },
  {
    path: '/level-test',
    name: 'LevelTest',
    component: LevelTest
  },
  {
    path: '/aitutor',
    name: 'AITutor',
    component: AITutor
  },
  {
    path: '/studylog',
    name: 'StudyLog',
    component: StudyLog
  },
  {
    path: '/ranking',
    name: 'Ranking',
    component: Ranking,
  },
  {
    path: '/mypage',
    name: 'MyPage',
    component: MyPage
  },
  {
    path: '/records/:id',
    name: 'RecordDetail',
    component: RecordDetail,
    props: true,
  },
  {
    path: '/share-capture',
    name: 'ShareCapture',
    component: ShareCapture,
  }
]

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: routes,
})

export default router
