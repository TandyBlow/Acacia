import { describe, expect, it } from 'vitest';
import { usernameToSyntheticEmail } from './usernameAuth';

describe('usernameToSyntheticEmail', () => {
  it('maps a username to a deterministic synthetic email', async () => {
    await expect(usernameToSyntheticEmail('alice')).resolves.toBe(
      'u.2bd806c97f0e00af1a1fc3328fa763a9269723c8db8fac4f93af71db186d6e90@seewhat.local',
    );
  });

  it('generates different emails for different usernames', async () => {
    const alice = await usernameToSyntheticEmail('alice');
    const bob = await usernameToSyntheticEmail('bob');
    expect(alice).not.toBe(bob);
  });
});
