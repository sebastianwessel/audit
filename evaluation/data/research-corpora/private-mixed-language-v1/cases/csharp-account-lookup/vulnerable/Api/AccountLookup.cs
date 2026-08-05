using System.Data;

public sealed class AccountLookup
{
    public string Find(string accountId)
    {
        var command = $"SELECT * FROM accounts WHERE account_id = '{accountId}'";
        return command;
    }
}
