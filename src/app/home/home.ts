import { Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { v4 as uuidv4 } from 'uuid';

@Component({
  selector: 'app-home',
  imports: [],
  templateUrl: './home.html',
})
export class Home {
  router = inject(Router);
  send(event: SubmitEvent) {
    event.preventDefault();
    const form = event.target as HTMLFormElement;
    const formData = new FormData(form);
    const query = formData.get('query');
    console.log('Query:', query);
    // Generate a random UUID for the result page using a library
    const uuid = uuidv4();
    console.log('Result Page ID:', uuid);
    this.router.navigate(['/r', uuid]);
  }
}
