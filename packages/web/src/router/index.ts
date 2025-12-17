import type { RouteRecordRaw } from 'vue-router'

export const routes: RouteRecordRaw[] = [
  {
    path: '/login',
    name: 'login',
    component: () => import('@/pages/LoginPage.vue'),
    meta: { public: true },
  },
  {
    path: '/',
    name: 'inbox',
    component: () => import('@/pages/IndexPage.vue'),
  },
  {
    // Dynamic folder route - matches folder by name
    path: '/folder/:name',
    name: 'folder',
    component: () => import('@/pages/IndexPage.vue'),
    props: true,
  },
  {
    path: '/reply-later',
    name: 'reply-later',
    component: () => import('@/pages/ReplyLaterPage.vue'),
  },
  {
    path: '/set-aside',
    name: 'set-aside',
    component: () => import('@/pages/SetAsidePage.vue'),
  },
  {
    path: '/attachments',
    name: 'attachments',
    component: () => import('@/pages/AttachmentsPage.vue'),
  },
  {
    path: '/search',
    name: 'search',
    component: () => import('@/pages/SearchPage.vue'),
  },
  {
    path: '/contacts',
    name: 'contacts',
    component: () => import('@/pages/ContactsPage.vue'),
  },
  {
    path: '/thread/:id',
    name: 'thread',
    component: () => import('@/pages/ThreadPage.vue'),
  },
  {
    path: '/draft/:id',
    name: 'draft',
    component: () => import('@/pages/DraftPage.vue'),
  },
  {
    path: '/contact/:id',
    name: 'contact',
    component: () => import('@/pages/ContactPage.vue'),
  },
  {
    path: '/attachment/:id',
    name: 'attachment',
    component: () => import('@/pages/AttachmentPage.vue'),
  },
  {
    path: '/rules',
    name: 'rules',
    component: () => import('@/pages/RulesPage.vue'),
  },
  {
    path: '/folders',
    name: 'folders',
    component: () => import('@/pages/FoldersPage.vue'),
  },
]
