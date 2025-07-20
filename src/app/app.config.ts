import { ApplicationConfig, provideBrowserGlobalErrorListeners, provideZonelessChangeDetection } from '@angular/core';
import { provideRouter } from '@angular/router';

import { routes } from './app.routes';
import { provideClientHydration, withEventReplay } from '@angular/platform-browser';
import { provideHttpClient, withFetch } from '@angular/common/http';
import { initializeApp, provideFirebaseApp } from '@angular/fire/app';
import { getAuth, provideAuth } from '@angular/fire/auth';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZonelessChangeDetection(),
    provideRouter(routes),
    provideClientHydration(withEventReplay()),
    provideHttpClient(withFetch()), provideFirebaseApp(() => initializeApp({ projectId: "friendlai-62296", appId: "1:340372337298:web:e36295c62aa6af0cf26c4b", storageBucket: "friendlai-62296.firebasestorage.app", apiKey: "AIzaSyDr3EW-ZdPR62BLoDVbfS4jiS4y1EsC8Mo", authDomain: "friendlai-62296.firebaseapp.com", messagingSenderId: "340372337298", measurementId: "G-6FNWY6L7QL" })), provideAuth(() => getAuth()),
  ],
};
