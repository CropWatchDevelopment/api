import {
  addRuleRecipients,
  hideStaffAuthor,
  hideStaffAuthorsInRows,
  readRuleRecipients,
  ruleRecipientKind,
  splitStaffRecipients,
  withoutStaffEmails,
  writeRuleRecipients,
} from './staff-redaction.helper';

describe('staff-redaction.helper', () => {
  describe('withoutStaffEmails', () => {
    const rows = [
      { id: 1, email: 'farmer@example.com' },
      { id: 2, email: 'Support@CropWatch.io ' },
      { id: 3, email: null },
    ];

    it('hides staff addresses from customers', () => {
      expect(withoutStaffEmails(rows, false).map((row) => row.id)).toEqual([
        1, 3,
      ]);
    });

    it('shows staff everything', () => {
      expect(withoutStaffEmails(rows, true)).toBe(rows);
    });
  });

  describe('hideStaffAuthor', () => {
    const staffNote = { id: 1, created_by: 'kevin@cropwatch.io' };
    const customerNote = { id: 2, created_by: 'farmer@example.com' };

    it('blanks a staff author for customers and flags it', () => {
      expect(hideStaffAuthor(staffNote, false)).toEqual({
        id: 1,
        created_by: null,
        created_by_staff: true,
      });
    });

    it('keeps a staff author for staff', () => {
      expect(hideStaffAuthor(staffNote, true)).toEqual({
        id: 1,
        created_by: 'kevin@cropwatch.io',
        created_by_staff: true,
      });
    });

    it('keeps a customer author', () => {
      expect(hideStaffAuthor(customerNote, false)).toEqual({
        id: 2,
        created_by: 'farmer@example.com',
        created_by_staff: false,
      });
    });

    it('hides the authors of the notes data rows embed', () => {
      const rows = [
        { id: 10, cw_air_annotations: [staffNote, customerNote] },
        { id: 11, cw_air_annotations: null },
        { id: 12 },
      ];

      expect(hideStaffAuthorsInRows(rows, false)).toEqual([
        {
          id: 10,
          cw_air_annotations: [
            { id: 1, created_by: null, created_by_staff: true },
            {
              id: 2,
              created_by: 'farmer@example.com',
              created_by_staff: false,
            },
          ],
        },
        { id: 11, cw_air_annotations: null },
        { id: 12 },
      ]);
    });
  });

  describe('rule recipients', () => {
    it('knows which action types address people', () => {
      expect(ruleRecipientKind('EMail')).toBe('email');
      expect(ruleRecipientKind('LINE')).toBe('userIds');
      expect(ruleRecipientKind('Push')).toBe('userIds');
      expect(ruleRecipientKind('LoRaWAN')).toBeNull();
      expect(ruleRecipientKind(null)).toBeNull();
    });

    it('reads a comma- or semicolon-separated address list', () => {
      expect(
        readRuleRecipients('email', {
          recipient: ' a@example.com,b@example.com ; kevin@cropwatch.io,,',
        }),
      ).toEqual(['a@example.com', 'b@example.com', 'kevin@cropwatch.io']);
    });

    it('reads LINE/Push user ids', () => {
      expect(
        readRuleRecipients('userIds', {
          recipient: JSON.stringify({ userIds: ['u1', 2, 'u3'] }),
        }),
      ).toEqual(['u1', 'u3']);
    });

    it('reads no one from a missing or malformed config', () => {
      expect(readRuleRecipients('email', null)).toEqual([]);
      expect(readRuleRecipients('email', ['a@example.com'])).toEqual([]);
      expect(readRuleRecipients('email', { recipient: 42 })).toEqual([]);
      expect(readRuleRecipients('userIds', { recipient: 'not json' })).toEqual(
        [],
      );
      expect(readRuleRecipients('userIds', { recipient: 'null' })).toEqual([]);
      expect(
        readRuleRecipients('userIds', { recipient: '{"userIds":"u1"}' }),
      ).toEqual([]);
    });

    it('writes recipients back, keeping the other config keys', () => {
      expect(
        writeRuleRecipients('email', { recipient: 'x', extra: 1 }, [
          'a@example.com',
          'b@example.com',
        ]),
      ).toEqual({ recipient: 'a@example.com, b@example.com', extra: 1 });
      expect(writeRuleRecipients('userIds', null, ['u1'])).toEqual({
        recipient: '{"userIds":["u1"]}',
      });
    });

    it('adds recipients it does not have yet', () => {
      expect(
        addRuleRecipients('email', { recipient: 'a@example.com' }, [
          'A@example.com',
          'kevin@cropwatch.io',
        ]),
      ).toEqual({ recipient: 'a@example.com, kevin@cropwatch.io' });
      expect(
        addRuleRecipients(
          'userIds',
          { recipient: JSON.stringify({ userIds: ['u1'] }) },
          ['u1', 'staff-1'],
        ),
      ).toEqual({ recipient: '{"userIds":["u1","staff-1"]}' });
    });

    it('splits the staff recipients from the visible ones', () => {
      expect(
        splitStaffRecipients(
          'email',
          { recipient: 'a@example.com, kevin@cropwatch.io' },
          (recipient) => recipient.endsWith('@cropwatch.io'),
        ),
      ).toEqual({ visible: ['a@example.com'], staff: ['kevin@cropwatch.io'] });
    });
  });
});
