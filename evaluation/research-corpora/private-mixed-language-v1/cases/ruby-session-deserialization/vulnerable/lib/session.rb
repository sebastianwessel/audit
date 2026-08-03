class Session
  def self.restore(cookie)
    Marshal.load(cookie)
  end
end
