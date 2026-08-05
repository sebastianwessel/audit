class Session
  def self.restore(serialized)
    Marshal.load(serialized)
  end
end
