import { RenderMode, ServerRoute } from '@angular/ssr';

export const serverRoutes: ServerRoute[] = [
  {
    path: '**',
    renderMode: RenderMode.Client,
  },
  { path: 'r/:id', renderMode: RenderMode.Server },
  { path: 'privacy', renderMode: RenderMode.Prerender },
  { path: 'about', renderMode: RenderMode.Prerender },
];
