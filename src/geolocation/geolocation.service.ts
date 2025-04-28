import { Injectable } from '@nestjs/common';

@Injectable()
export class GeolocationService {

    public async getGeolocation(address: string) {
        const response = await fetch(`https://geocode.maps.co/search?q=${address}&api_key=${process.env.GEOCODING_API_KEY}`);
        
        if (!response.ok) {
            throw new Error(`Error fetching geolocation: ${response.statusText}`);
        }

        const data = await response.json();
        return data;
  }
}
