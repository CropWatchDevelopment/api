import { Controller, Get, Req, Query } from '@nestjs/common';
import { RelayService } from './relay.service';
import { ApiTags, ApiQuery, ApiResponse } from '@nestjs/swagger';
import { Public } from 'src/auth/public.decorator';

enum RelayState {
    Open = 'open (OFF)', // OFF
    Close = 'close (ON)' // ON
}

@ApiTags('Relay - Automation')
@Controller('relay')
export class RelayController {
    constructor(private readonly relayService: RelayService) { }

    @Public()
    @Get('control')
    @ApiQuery({
        name: 'state',
        enum: RelayState,
        description: 'Set the relay state to Open or Close'
    })
    @ApiResponse({ status: 202, description: 'Action Queued' })
    @ApiResponse({ status: 400, description: 'Bad Request' })
    @ApiResponse({ status: 401, description: 'Unauthorized' })
    @ApiResponse({ status: 402, description: 'Payment Required' })
    @ApiResponse({ status: 403, description: 'Forbidden' })
    async getProtectedRoute(@Query('state') state: RelayState, @Req() req) {
        const relayOn = state === RelayState.Open;
        const response = await this.relayService.sendDownlink(relayOn);
        return { message: 'Relay state updated', response };
    }
}
