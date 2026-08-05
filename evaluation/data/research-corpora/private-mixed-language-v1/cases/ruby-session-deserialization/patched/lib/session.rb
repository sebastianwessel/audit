require 'json'

class Session
  def self.restore(serialized)
    JSON.parse(serialized, symbolize_names: true)
  end
end
