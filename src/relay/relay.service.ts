import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class RelayService {
    constructor() {}
    
    public async sendDownlink(state: boolean) {
        const appId = 'dragino-lt-22222';
        const deviceId = 'dragino-test';
        const accessKey = process.env.DRAGINO_API_KEY;
    
        const url = `${process.env.TTI_BASE_URL}/api/v3/as/applications/${appId}/devices/${deviceId}/down/replace`;
        const onCommand = "030011";
        const offCommand = "030111";
        const command = state ? onCommand : offCommand;

        const data = {
            downlinks: [
                {
                    frm_payload: this.hexToBase64(command), // Base64-encoded payload
                    f_port: 1, // Change as needed
                    confirmed: true,
                    priority: 'HIGH',
                }
            ]
        };
    
        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${accessKey}`,
                    'Content-Type': 'application/json',
                    'User-Agent': 'my-integration/my-integration-version'
                },
                body: JSON.stringify(data)
            });
    
            if (!response.ok) {
                throw new Error(`Error sending downlink: ${response.statusText}`);
            }
    
            const responseData = await response.json();
            console.log('Downlink sent successfully:', responseData);
            return responseData;
        } catch (error) {
            console.error('Error sending downlink:', error.message);
        }
    }

    private hexToBase64(hexString) {
        const bytes = new Uint8Array(hexString.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));
        return btoa(String.fromCharCode(...bytes));
    }
    
}
