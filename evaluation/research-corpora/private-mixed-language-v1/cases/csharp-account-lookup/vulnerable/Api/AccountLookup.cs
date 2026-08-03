using Microsoft.Data.SqlClient;

public static class AccountLookup
{
    public static SqlCommand ByEmail(SqlConnection connection, string email)
    {
        return new SqlCommand("SELECT id, role FROM accounts WHERE email = '" + email + "'", connection);
    }
}
