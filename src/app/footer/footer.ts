import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import versionJson from '../../../worker/version.json';
@Component({
  selector: 'app-footer',
  imports: [RouterLink],
  templateUrl: './footer.html',
  styleUrls: ['./footer.scss'],
})
export class Footer {
  version = versionJson.version;
}
