using System.Data;

public sealed class AccountLookup
{
    public IDbCommand Find(IDbConnection connection, string accountId)
    {
        var command = connection.CreateCommand();
        command.CommandText = "SELECT * FROM accounts WHERE account_id = @accountId";
        var parameter = command.CreateParameter();
        parameter.ParameterName = "@accountId";
        parameter.Value = accountId;
        command.Parameters.Add(parameter);
        return command;
    }
}
