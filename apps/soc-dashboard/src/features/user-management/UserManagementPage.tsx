import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Table, Tbody, Td, Th, Thead, Tr } from '../../components/ui/Table';
import { useSetUserActive, useUsers } from '../../hooks/useUsers';

export function UserManagementPage() {
  const { data: users, isLoading, isError } = useUsers();
  const setActive = useSetUserActive();

  if (isLoading) {
    return <p className="text-sm text-slate-400">Loading users…</p>;
  }

  if (isError) {
    return (
      <Card>
        <p className="text-sm text-mirqab-danger">
          Could not load users. Confirm the backend is running and this account has the Admin role.
        </p>
      </Card>
    );
  }

  return (
    <Card>
      <h2 className="mb-4 text-sm font-semibold text-white">User management</h2>
      <Table>
        <Thead>
          <Tr>
            <Th>Name</Th>
            <Th>Email</Th>
            <Th>Role</Th>
            <Th>Status</Th>
            <Th />
          </Tr>
        </Thead>
        <Tbody>
          {users?.map((user) => (
            <Tr key={user.id}>
              <Td className="text-slate-200">
                {user.firstName} {user.lastName}
              </Td>
              <Td className="text-slate-400">{user.email}</Td>
              <Td className="text-slate-400">{user.role}</Td>
              <Td>
                <Badge status={user.isActive ? 'success' : 'unknown'}>
                  {user.isActive ? 'Active' : 'Pending / Deactivated'}
                </Badge>
              </Td>
              <Td>
                <Button
                  variant={user.isActive ? 'danger' : 'secondary'}
                  className="px-2.5 py-1 text-xs"
                  disabled={setActive.isPending}
                  onClick={() => setActive.mutate({ id: user.id, isActive: !user.isActive })}
                >
                  {user.isActive ? 'Deactivate' : 'Activate'}
                </Button>
              </Td>
            </Tr>
          ))}
        </Tbody>
      </Table>
    </Card>
  );
}
