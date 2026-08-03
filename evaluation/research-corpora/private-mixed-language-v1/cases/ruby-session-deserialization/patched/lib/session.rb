require "json"

class Session
  def self.restore(cookie)
    JSON.parse(cookie)
  end
end
