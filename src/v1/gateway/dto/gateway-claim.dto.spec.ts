import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { GatewayClaimDto } from './gateway-claim.dto';

async function check(body: Record<string, unknown>) {
  const dto = plainToInstance(GatewayClaimDto, body);
  const errors = await validate(dto, {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  return { dto, failed: errors.map((error) => error.property) };
}

describe('GatewayClaimDto', () => {
  it('accepts an EUI with separators and no email', async () => {
    await expect(
      check({ gateway_eui: '64:7F:DA:FF:FE:02:D2:02' }),
    ).resolves.toMatchObject({ failed: [] });
  });

  it('treats a blank email as no email', async () => {
    const { dto, failed } = await check({
      gateway_eui: '647FDAFFFE02D202',
      user_email: '   ',
    });
    expect(failed).toEqual([]);
    expect(dto.user_email).toBeUndefined();
  });

  it('trims the email', async () => {
    const { dto, failed } = await check({
      gateway_eui: '647FDAFFFE02D202',
      user_email: ' info@example.com ',
    });
    expect(failed).toEqual([]);
    expect(dto.user_email).toBe('info@example.com');
  });

  it.each([
    [{ gateway_eui: '647FDAFFFE02D2' }, 'gateway_eui'],
    [{ gateway_eui: '647FDAFFFE02D2ZZ' }, 'gateway_eui'],
    [{ gateway_eui: '647FDAFFFE02D202', user_email: 'nope' }, 'user_email'],
    [{ gateway_eui: '647FDAFFFE02D202', user_id: 'x' }, 'user_id'],
  ])('rejects %j', async (body, property) => {
    await expect(check(body)).resolves.toMatchObject({ failed: [property] });
  });
});
